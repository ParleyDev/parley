import { useStore } from '../store'
import { applySfxSink, playSfx } from './sfx'
import type { VoiceState } from './types'
import { sendOp, type SignalData } from './ws'
import { supportsSinkId, type VoiceSettings } from './settings'
import { keepAwake } from './native'
import { api } from './api'
import { captureConstraints, measure, profileOf, sameProfile, tuneAudioReceiver, tuneAudioSender, tuneOpusSdp, type AudioProfile, type AudioStat } from './audioProfile'
import { LocalAudioTrack, LocalVideoTrack, RemoteTrack, Room, RoomEvent, Track, type RemoteParticipant } from 'livekit-client'

/**
 * Mesh WebRTC voice/video: every participant holds one RTCPeerConnection per other participant.
 * Signaling rides the app WebSocket. Rule to avoid glare: the *joiner* sends offers to everyone
 * already in the channel; existing members only answer.
 *
 * Each connection carries three fixed transceivers negotiated once: [audio, camera, screen].
 * Turning camera/screen on or off swaps the sender track with replaceTrack(), so no renegotiation
 * is ever needed. Remote on/off state comes from VOICE_STATE_UPDATE flags.
 *
 * Microphone pipeline (Web Audio): device → inputGain (input volume) → gate (voice activity /
 * push-to-talk) → destination. Peers receive the destination track, so swapping the input device
 * or changing volume never needs a track replacement.
 */
interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  pendingCandidates: RTCIceCandidateInit[]
  stopMeter?: () => void
  /** We sent the first offer, so we drive renegotiation when the channel's audio profile changes. */
  offerer: boolean
}

const CAMERA_MAX_BITRATE = 1_500_000
const SCREEN_MAX_BITRATE = 3_000_000
const AUTO_THRESHOLD_DB = -45
const VAD_HOLD_MS = 400
const GATE_INTERVAL_MS = 50

type MicHolder = 'call' | 'test'

class VoiceManager {
  // mic pipeline
  private raw: MediaStream | null = null       // device stream
  private mic: MediaStream | null = null       // processed stream sent to peers
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private inputGain: GainNode | null = null
  private gate: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private gateTimer: ReturnType<typeof setInterval> | null = null
  private lastVoiceAt = 0
  private pttDown = false
  private pttUpAt = 0
  private holders = new Set<MicHolder>()
  /** Audio profile of the channel we are in (or joining); drives capture, Opus parameters and jitter buffers. */
  private profile: AudioProfile = profileOf(null)
  private testAudio: HTMLAudioElement | null = null
  private acquiring: Promise<boolean> | null = null

  private camera: MediaStream | null = null
  private screen: MediaStream | null = null
  private peers = new Map<string, Peer>()
  private channelId: string | null = null
  private joining = false
  private muteBeforeDeaf = false

  // SFU (LiveKit) transport, used instead of the mesh when the instance has a server configured.
  private room: Room | null = null
  private sfuAudio = new Map<string, HTMLAudioElement>()
  private sfuMeters = new Map<string, () => void>()
  private sfuCamera: LocalVideoTrack | null = null
  private sfuMic: LocalAudioTrack | null = null
  private sfuScreen: LocalVideoTrack | null = null

  /** Debug/test window: current transport and room state. */
  get debug(): { mode: string; room: string | null; remote: number; channel: string | null } { return { mode: this.sfu ? 'sfu' : 'mesh', room: this.room ? String(this.room.state) : null, remote: this.room?.remoteParticipants.size ?? this.peers.size, channel: this.channelId } }
  private get sfu(): boolean { return useStore.getState().instance.voice_mode === 'sfu' }

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.onKey(e, true), true)
      window.addEventListener('keyup', (e) => this.onKey(e, false), true)
      window.addEventListener('blur', () => { this.pttDown = false; useStore.getState().setPttHeld(false) })
      // An admin changing the channel's audio profile mid-call applies to everyone in it without rejoining.
      useStore.subscribe((s, prev) => {
        const id = this.channelId
        if (!id || s.channels[id] === prev.channels[id]) return
        const next = profileOf(s.channels[id])
        if (!sameProfile(next, this.profile)) this.applyProfile(next)
      })
    }
  }

  /** The active audio profile (for the UI). */
  get audioProfile(): AudioProfile { return this.profile }

  private profileFor(channelId: string): AudioProfile {
    const s = useStore.getState()
    return profileOf(s.channels[channelId] ?? null)
  }

  /** Switch profile live: re-open the mic if capture changed, renegotiate mesh peers we offered to, republish to the SFU. */
  private async applyProfile(next: AudioProfile) {
    const prev = this.profile
    this.profile = next
    if (this.raw && (prev.mode !== next.mode || prev.lowLatency !== next.lowLatency)) await this.reopenMicDevice()
    for (const peer of this.peers.values()) {
      peer.pc.getReceivers().forEach((r) => { if (r.track.kind === 'audio') tuneAudioReceiver(r, next) })
      if (peer.offerer) this.renegotiate(peer)
    }
    if (this.room) await this.sfuPublishMic()
  }

  private async renegotiate(peer: Peer) {
    const to = [...this.peers.entries()].find(([, p]) => p === peer)?.[0]
    if (!to) return
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      sendOp({ op: 'voice_signal', to, data: { type: 'offer', sdp: tuneOpusSdp(offer.sdp ?? '', this.profile) } })
    } catch (e) { console.warn('renegotiation failed', e) }
  }

  private tunePeer(pc: RTCPeerConnection) {
    pc.getSenders().forEach((s) => { if (s.track?.kind === 'audio') tuneAudioSender(s, this.profile) })
    pc.getReceivers().forEach((r) => { if (r.track.kind === 'audio') tuneAudioReceiver(r, this.profile) })
  }

  /** Test/debug view: profile, stats, and the Opus fmtp + ptime lines of each mesh peer's local and remote descriptions. */
  async audioDebug() {
    const opus = (sdp?: string) => {
      if (!sdp) return null
      const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1]
      return { fmtp: pt ? (new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`).exec(sdp)?.[1] ?? '') : '', ptime: /a=ptime:(\d+)/.exec(sdp)?.[1] ?? null }
    }
    const peers = [...this.peers.entries()].map(([id, p]) => ({ id, local: opus(p.pc.localDescription?.sdp), remote: opus(p.pc.remoteDescription?.sdp) }))
    return { profile: this.profile, stats: await this.audioStats(), peers, constraints: this.raw?.getAudioTracks()[0]?.getSettings() ?? null }
  }

  /** Live per-participant audio numbers: codec, bitrate in/out, frame size, jitter buffer, round trip, loss. */
  async audioStats(): Promise<AudioStat[]> {
    const out: AudioStat[] = []
    for (const [userId, p] of this.peers) { try { out.push(await measure(userId, { pc: p.pc })) } catch { /* closed */ } }
    if (this.room) {
      const sender = this.sfuMic?.sender
      for (const part of this.room.remoteParticipants.values()) {
        const pub = [...part.audioTrackPublications.values()][0]
        const receiver = pub?.track?.receiver
        if (receiver) { try { out.push(await measure(part.identity, { receiver, sender })) } catch { /* gone */ } }
      }
    }
    return out
  }

  get currentChannel() { return this.channelId }
  private get settings(): VoiceSettings { return useStore.getState().voiceSettings }

  // ---- public controls ----

  async join(channelId: string) {
    keepAwake(true)
    if (this.joining) return
    const s = useStore.getState()
    if (this.channelId === channelId) return
    this.joining = true
    try {
      const next = this.profileFor(channelId)
      const captureChanged = next.mode !== this.profile.mode || next.lowLatency !== this.profile.lowLatency
      this.profile = next
      if (this.raw && captureChanged) await this.reopenMicDevice()
      if (!(await this.acquireMic('call'))) return
      // Moving channels: tear down old peers; camera/screen stay on and re-attach to new peers.
      if (this.channelId) this.closeAllPeers()
      this.channelId = channelId
      s.setMyVoice(channelId, true)
      s.setLocalMedia({ camera: this.camera, screen: this.screen })
      if (!sendOp({ op: 'voice_join', channel_id: channelId })) {
        s.pushToast('Not connected to the server', 'error')
        this.leave()
      }
    } finally {
      this.joining = false
    }
  }

  leave(evicted = false) {
    keepAwake(false)
    const s = useStore.getState()
    if (this.channelId) { sendOp({ op: 'voice_leave' }); playSfx(evicted ? 'disconnect' : 'user_leave') }
    this.channelId = null
    this.closeAllPeers()
    this.disconnectSfu()
    this.releaseMic('call')
    this.stopTracks(this.camera); this.camera = null
    this.stopTracks(this.screen); this.screen = null
    s.setMyVoice(null)
  }

  setMute(mute: boolean) {
    const s = useStore.getState()
    const deaf = mute ? s.selfDeaf : false // unmuting also undeafens, like Discord
    if (mute !== s.selfMute) playSfx(mute ? 'mute' : 'unmute')
    s.setSelfVoiceFlags(mute, deaf)
    this.applyMute(mute)
    this.applyDeaf(deaf)
    this.pushState()
  }

  setDeaf(deaf: boolean) {
    const s = useStore.getState()
    // Deafening also mutes; undeafening restores the prior mute choice.
    if (deaf) this.muteBeforeDeaf = s.selfMute
    const mute = deaf ? true : this.muteBeforeDeaf
    if (deaf !== s.selfDeaf) playSfx(deaf ? 'deafen' : 'undeafen')
    s.setSelfVoiceFlags(mute, deaf)
    this.applyMute(mute)
    this.applyDeaf(deaf)
    this.pushState()
  }

  async toggleCamera() {
    const s = useStore.getState()
    if (this.camera) {
      this.stopTracks(this.camera); this.camera = null
      this.peers.forEach((p) => this.replaceVideo(p.pc, 0, null))
      await this.sfuUnpublish('camera')
      s.setLocalMedia({ camera: null })
      this.pushState()
      return
    }
    const stream = await this.openCamera()
    if (!stream) return
    this.camera = stream
    const track = stream.getVideoTracks()[0]
    track.onended = () => { if (this.camera) this.toggleCamera() }
    this.peers.forEach((p) => this.replaceVideo(p.pc, 0, track))
    await this.sfuPublish('camera', track)
    s.setLocalMedia({ camera: this.camera })
    this.pushState()
  }

  async toggleScreen() {
    const s = useStore.getState()
    if (this.screen) {
      this.stopTracks(this.screen); this.screen = null
      this.peers.forEach((p) => this.replaceVideo(p.pc, 1, null))
      await this.sfuUnpublish('screen')
      s.setLocalMedia({ screen: null })
      playSfx('stream_stopped')
      this.pushState()
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) { s.pushToast('Screen sharing is not supported in this browser', 'error'); return }
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false })
      playSfx('stream_started')
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') s.pushToast(`Screen share failed: ${(e as Error).message}`, 'error')
      return
    }
    const track = this.screen.getVideoTracks()[0]
    // Browser "Stop sharing" button ends the track.
    track.onended = () => { if (this.screen) this.toggleScreen() }
    this.peers.forEach((p) => this.replaceVideo(p.pc, 1, track))
    await this.sfuPublish('screen', track)
    s.setLocalMedia({ screen: this.screen })
    this.pushState()
  }

  // ---- settings ----

  /** Called after the store's voiceSettings change; applies whatever changed live. */
  async applySettings(prev: VoiceSettings) {
    const cur = this.settings
    if (this.inputGain) this.inputGain.gain.value = cur.inputVolume / 100
    if (prev.outputDeviceId !== cur.outputDeviceId || prev.outputVolume !== cur.outputVolume) { this.peers.forEach((p) => this.applyOutput(p.audio)); this.sfuAudio.forEach((a) => this.applyOutput(a)); applySfxSink(cur.outputDeviceId) }
    const micChanged = prev.inputDeviceId !== cur.inputDeviceId || prev.echoCancellation !== cur.echoCancellation
      || prev.noiseSuppression !== cur.noiseSuppression || prev.autoGainControl !== cur.autoGainControl
    if (micChanged && this.raw) await this.reopenMicDevice()
    if (prev.cameraDeviceId !== cur.cameraDeviceId && this.camera) {
      const stream = await this.openCamera()
      if (stream) {
        this.stopTracks(this.camera)
        this.camera = stream
        const track = stream.getVideoTracks()[0]
        track.onended = () => { if (this.camera) this.toggleCamera() }
        this.peers.forEach((p) => this.replaceVideo(p.pc, 0, track))
        useStore.getState().setLocalMedia({ camera: stream })
      }
    }
    if (prev.inputMode !== cur.inputMode) { this.pttDown = false; useStore.getState().setPttHeld(false) }
  }

  /** Opens the mic (if needed) and plays it back locally so the user can hear themselves. */
  async startMicTest(): Promise<boolean> {
    if (!(await this.acquireMic('test'))) return false
    if (!this.testAudio) {
      this.testAudio = document.createElement('audio')
      this.testAudio.autoplay = true
      document.body.appendChild(this.testAudio)
    }
    this.testAudio.srcObject = this.mic
    this.applyOutput(this.testAudio)
    this.testAudio.play().catch(() => {})
    return true
  }

  stopMicTest() {
    if (this.testAudio) { this.testAudio.srcObject = null; this.testAudio.remove(); this.testAudio = null }
    this.releaseMic('test')
  }

  /** Keep the level meter running (without playback) while the settings panel is open. */
  async startMeter(): Promise<boolean> { return this.acquireMic('test') }
  stopMeter() { if (!this.testAudio) this.releaseMic('test') }

  /** Camera stream for the settings preview, using the chosen device. Caller stops it. */
  async openCamera(): Promise<MediaStream | null> {
    const id = this.settings.cameraDeviceId
    const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    if (id) video.deviceId = { exact: id }
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false })
    } catch (e) {
      if (id) {
        // Chosen device vanished: fall back to default and forget the choice.
        useStore.getState().updateVoiceSettings({ cameraDeviceId: '' })
        try { return await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined }, audio: false }) } catch { /* fallthrough */ }
      }
      useStore.getState().pushToast(`Camera unavailable: ${(e as Error).message}`, 'error')
      return null
    }
  }

  // ---- events from the socket ----

  /** Our own or another user's voice state changed. */
  onVoiceState(v: VoiceState) {
    const me = useStore.getState().user?.id
    if (!me || !this.channelId) return
    if (v.user_id === me) {
      if (v.channel_id === this.channelId) {
        const s = useStore.getState()
        if (s.voiceConnecting) {
          // Server acknowledged our join: offer to everyone already here (mesh) or join the SFU room,
          // then re-announce media flags.
          s.setMyVoice(this.channelId, false)
          playSfx('user_join')
          if (this.sfu) {
            this.connectSfu(this.channelId)
          } else {
            const others = Object.values(s.voiceStates).filter((o) => o.channel_id === this.channelId && o.user_id !== me)
            others.forEach((o) => { if (!this.peers.has(o.user_id)) this.offerTo(o.user_id) })
          }
          if (this.camera || this.screen || s.selfMute || s.selfDeaf) this.pushState()
        }
      } else if (v.channel_id === null) {
        // Server evicted us (kicked, channel deleted, another tab took over).
        this.leave(true)
      }
      return
    }
    if (v.channel_id !== this.channelId && this.peers.has(v.user_id)) this.closePeer(v.user_id)
  }

  async onSignal(from: string, channelId: string, data: SignalData) {
    if (channelId !== this.channelId || this.sfu) return
    const peer = this.peers.get(from) ?? this.createPeer(from, false)
    try {
      if (data.type === 'offer') {
        // A renegotiation offer can beat our own CHANNEL_UPDATE: answer with the channel's current profile.
        const fresh = this.profileFor(channelId)
        if (!sameProfile(fresh, this.profile)) await this.applyProfile(fresh)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        this.attachLocalTracks(peer.pc)
        await this.flushCandidates(peer)
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        sendOp({ op: 'voice_signal', to: from, data: { type: 'answer', sdp: tuneOpusSdp(answer.sdp ?? '', this.profile) } })
        this.tunePeer(peer.pc)
      } else if (data.type === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushCandidates(peer)
        this.tunePeer(peer.pc)
      } else if (data.type === 'candidate') {
        if (!data.candidate) return
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate)
        else peer.pendingCandidates.push(data.candidate)
      }
    } catch (e) {
      console.warn('voice signal error', e)
    }
  }

  /** Socket reconnected: server state is gone, so re-join the channel we were in. */
  onReconnect() {
    if (this.channelId) {
      const ch = this.channelId
      this.closeAllPeers()
      useStore.getState().setMyVoice(ch, true)
      sendOp({ op: 'voice_join', channel_id: ch })
    }
  }

  onSocketLost() {
    if (this.channelId) useStore.getState().setMyVoice(this.channelId, true)
  }

  // ---- mic pipeline ----

  private micConstraints(): MediaStreamConstraints {
    const st = this.settings
    const audio: MediaTrackConstraints = captureConstraints(this.profile, st)
    if (st.inputDeviceId) audio.deviceId = { exact: st.inputDeviceId }
    return { audio, video: false }
  }

  private async getRawMic(): Promise<MediaStream | null> {
    const s = useStore.getState()
    if (!navigator.mediaDevices?.getUserMedia) {
      s.pushToast(window.isSecureContext
        ? 'This browser does not support microphone capture'
        : `Microphone needs a secure context. Open the app over HTTPS (e.g. https://${location.hostname}:3443) or via localhost.`, 'error')
      return null
    }
    try {
      return await navigator.mediaDevices.getUserMedia(this.micConstraints())
    } catch (e) {
      if (this.settings.inputDeviceId) {
        s.updateVoiceSettings({ inputDeviceId: '' })
        try { return await navigator.mediaDevices.getUserMedia(this.micConstraints()) } catch { /* fallthrough */ }
      }
      s.pushToast(`Microphone unavailable: ${(e as Error).message}`, 'error')
      return null
    }
  }

  private acquireMic(holder: MicHolder): Promise<boolean> {
    this.holders.add(holder)
    if (this.mic) return Promise.resolve(true)
    if (this.acquiring) return this.acquiring
    this.acquiring = (async () => {
      const raw = await this.getRawMic()
      if (!raw) { this.holders.delete(holder); return false }
      if (!this.holders.size) { this.stopTracks(raw); return false } // released while waiting
      this.raw = raw
      const ctx = (this.ctx ??= newAudioContext())
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      this.inputGain = ctx.createGain(); this.inputGain.gain.value = this.settings.inputVolume / 100
      this.gate = ctx.createGain(); this.gate.gain.value = 0
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024
      this.dest = ctx.createMediaStreamDestination()
      this.source = ctx.createMediaStreamSource(raw)
      this.source.connect(this.inputGain)
      this.inputGain.connect(this.analyser)
      this.inputGain.connect(this.gate)
      this.gate.connect(this.dest)
      this.mic = this.dest.stream
      const s = useStore.getState()
      this.applyMute(s.selfMute || s.selfDeaf)
      this.startGate()
      return true
    })().finally(() => { this.acquiring = null })
    return this.acquiring
  }

  private releaseMic(holder: MicHolder) {
    this.holders.delete(holder)
    if (this.holders.size) return
    if (this.gateTimer) { clearInterval(this.gateTimer); this.gateTimer = null }
    this.source?.disconnect(); this.inputGain?.disconnect(); this.gate?.disconnect(); this.analyser?.disconnect()
    this.source = this.inputGain = this.gate = this.analyser = this.dest = null
    this.stopTracks(this.raw); this.raw = null
    this.stopTracks(this.mic); this.mic = null
    this.ctx?.close().catch(() => {}); this.ctx = null
    const s = useStore.getState()
    s.setInputLevel(-100, false)
    if (s.user) s.setSpeaking(s.user.id, false)
  }

  /** Swap the capture device under the running pipeline; the outgoing track is unchanged. */
  private async reopenMicDevice() {
    const raw = await this.getRawMic()
    if (!raw || !this.ctx || !this.inputGain) { if (raw) this.stopTracks(raw); return }
    this.source?.disconnect()
    this.stopTracks(this.raw)
    this.raw = raw
    this.source = this.ctx.createMediaStreamSource(raw)
    this.source.connect(this.inputGain)
  }

  private startGate() {
    if (this.gateTimer) clearInterval(this.gateTimer)
    const buf = new Float32Array(this.analyser!.fftSize)
    this.gateTimer = setInterval(() => {
      const analyser = this.analyser, gate = this.gate, ctx = this.ctx
      if (!analyser || !gate || !ctx) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const db = Math.max(-100, Math.min(0, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-5)))
      const st = this.settings
      const s = useStore.getState()
      const now = Date.now()
      let open: boolean
      if (st.inputMode === 'ptt') {
        open = this.pttDown || now - this.pttUpAt < st.pttRelease
      } else if (st.inputMode === 'open') {
        open = true
      } else {
        const threshold = st.autoSensitivity ? AUTO_THRESHOLD_DB : st.sensitivity
        if (db >= threshold) this.lastVoiceAt = now
        open = now - this.lastVoiceAt < VAD_HOLD_MS
      }
      // Server-side "suppress" (no SPEAK permission) keeps the gate shut regardless of input mode.
      if (s.user && s.voiceStates[s.user.id]?.suppress) open = false
      gate.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, 0.015)
      const muted = s.selfMute || s.selfDeaf
      s.setInputLevel(Math.round(db), open && !muted)
      if (s.user) s.setSpeaking(s.user.id, open && !muted && db > -60)
    }, GATE_INTERVAL_MS)
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const st = this.settings
    if (st.inputMode !== 'ptt' || e.code !== st.pttKey) return
    const t = e.target as HTMLElement | null
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const modifier = /^(Control|Shift|Alt|Meta)/.test(e.code)
    if (typing && !modifier) return
    if (!typing) e.preventDefault()
    if (down && e.repeat) return
    if (this.pttDown !== down) playSfx(down ? 'ptt_activate' : 'ptt_deactivate')
    this.pttDown = down
    if (!down) this.pttUpAt = Date.now()
    useStore.getState().setPttHeld(down)
  }

  /** Studio recording: the microphone after input volume but before the talk gate, so takes are never clipped by VAD/PTT. */
  getRecordingStream(): MediaStream | null {
    if (this.ctx && this.inputGain) {
      const dest = this.ctx.createMediaStreamDestination()
      this.inputGain.connect(dest)
      return dest.stream
    }
    return this.raw ?? this.mic
  }

  /** Soundboard: play a short clip through the voice output device at the clip's volume (skipped while deafened). */
  playSound(url: string, volume: number, id?: string) {
    const w = window as unknown as { __parleySounds?: string[] }
    w.__parleySounds = [...(w.__parleySounds ?? []), id ?? url]
    if (useStore.getState().selfDeaf) return
    const el = new Audio(url)
    this.applyOutput(el)
    el.volume = Math.max(0, Math.min(1, el.volume * volume))
    el.play().catch(() => {})
  }

  private applyOutput(el: HTMLAudioElement) {
    const st = this.settings
    el.volume = Math.max(0, Math.min(1, st.outputVolume / 100))
    if (supportsSinkId) {
      (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(st.outputDeviceId || '').catch(() => {
        if (st.outputDeviceId) useStore.getState().updateVoiceSettings({ outputDeviceId: '' })
      })
    }
  }

  // ---- peers ----

  private pushState() {
    if (!this.channelId) return
    const s = useStore.getState()
    sendOp({ op: 'voice_state', self_mute: s.selfMute, self_deaf: s.selfDeaf, self_video: !!this.camera, self_stream: !!this.screen })
  }

  private async offerTo(userId: string) {
    const peer = this.createPeer(userId, true)
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      sendOp({ op: 'voice_signal', to: userId, data: { type: 'offer', sdp: tuneOpusSdp(offer.sdp ?? '', this.profile) } })
    } catch (e) {
      console.warn('offer failed', e)
      useStore.getState().setPeerStatus(userId, 'failed')
    }
  }

  private createPeer(userId: string, offerer: boolean): Peer {
    const s = useStore.getState()
    const pc = new RTCPeerConnection({ iceServers: s.iceServers })
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.muted = s.selfDeaf
    audio.dataset.peer = userId
    document.body.appendChild(audio)
    this.applyOutput(audio)
    const peer: Peer = { pc, audio, pendingCandidates: [], offerer }
    this.peers.set(userId, peer)
    s.setPeerStatus(userId, 'connecting')

    if (offerer) {
      // Fixed m-line layout; the answerer mirrors it by order.
      pc.addTransceiver(this.mic!.getAudioTracks()[0], { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      this.replaceVideo(pc, 0, this.camera?.getVideoTracks()[0] ?? null)
      this.replaceVideo(pc, 1, this.screen?.getVideoTracks()[0] ?? null)
    }

    pc.onicecandidate = (e) => sendOp({ op: 'voice_signal', to: userId, data: { type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null } })
    pc.ontrack = (e) => {
      const stream = new MediaStream([e.track])
      if (e.track.kind === 'audio') {
        tuneAudioReceiver(e.receiver, this.profile)
        audio.srcObject = stream
        audio.play().catch(() => {})
        peer.stopMeter?.()
        peer.stopMeter = this.remoteMeter(stream, userId)
        return
      }
      const idx = this.videoTransceivers(pc).indexOf(e.transceiver)
      useStore.getState().setRemoteMedia(userId, idx === 1 ? 'screen' : 'camera', stream)
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') { useStore.getState().setPeerStatus(userId, 'connected'); this.tunePeer(pc) }
      else if (st === 'failed') { useStore.getState().setPeerStatus(userId, 'failed'); pc.restartIce() }
      else if (st === 'disconnected') useStore.getState().setPeerStatus(userId, 'connecting')
    }
    return peer
  }

  /** Answerer side: mirror the offerer's [audio, camera, screen] layout with our own tracks. */
  private attachLocalTracks(pc: RTCPeerConnection) {
    const ts = pc.getTransceivers()
    const audio = ts.find((t) => t.receiver.track.kind === 'audio')
    if (audio) { audio.direction = 'sendrecv'; audio.sender.replaceTrack(this.mic?.getAudioTracks()[0] ?? null).catch(() => {}) }
    const videos = this.videoTransceivers(pc)
    videos.forEach((t) => (t.direction = 'sendrecv'))
    this.replaceVideo(pc, 0, this.camera?.getVideoTracks()[0] ?? null)
    this.replaceVideo(pc, 1, this.screen?.getVideoTracks()[0] ?? null)
  }

  private videoTransceivers(pc: RTCPeerConnection) {
    return pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video')
  }

  private replaceVideo(pc: RTCPeerConnection, slot: 0 | 1, track: MediaStreamTrack | null) {
    const t = this.videoTransceivers(pc)[slot]
    if (!t) return
    t.sender.replaceTrack(track).catch(() => {})
    if (track) {
      const params = t.sender.getParameters()
      if (!params.encodings?.length) params.encodings = [{}]
      params.encodings[0].maxBitrate = slot === 1 ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE
      if (slot === 1) params.degradationPreference = 'maintain-resolution'
      t.sender.setParameters(params).catch(() => {})
    }
  }

  private async flushCandidates(peer: Peer) {
    const list = peer.pendingCandidates.splice(0)
    for (const c of list) { try { await peer.pc.addIceCandidate(c) } catch { /* ignore stale */ } }
  }

  private closePeer(userId: string) {
    const p = this.peers.get(userId)
    if (!p) return
    p.stopMeter?.()
    p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null
    p.pc.close()
    p.audio.srcObject = null; p.audio.remove()
    this.peers.delete(userId)
    const s = useStore.getState()
    s.setPeerStatus(userId, null)
    s.setSpeaking(userId, false)
  }

  private closeAllPeers() { [...this.peers.keys()].forEach((id) => this.closePeer(id)) }

  private stopTracks(stream: MediaStream | null) { stream?.getTracks().forEach((t) => { t.onended = null; t.stop() }) }
  private applyMute(muted: boolean) { this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted)) }
  private applyDeaf(deaf: boolean) { this.peers.forEach((p) => (p.audio.muted = deaf)); this.sfuAudio.forEach((a) => (a.muted = deaf)) }

  // ---- SFU (LiveKit) ----

  private async connectSfu(channelId: string) {
    const s = useStore.getState()
    if (this.room) await this.disconnectSfu()
    let grant: { url: string; token: string }
    try { grant = await api.post<{ url: string; token: string }>('/voice/token', { channel_id: channelId }) } catch (e) { s.pushToast(`Voice server refused: ${(e as Error).message}`, 'error'); this.leave(); return }
    const room = new Room({ adaptiveStream: true, dynacast: true })
    this.room = room
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => this.onSfuTrack(track, participant))
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) { this.sfuAudio.get(participant.identity)?.remove(); this.sfuAudio.delete(participant.identity); this.sfuMeters.get(participant.identity)?.(); this.sfuMeters.delete(participant.identity) }
      else useStore.getState().setRemoteMedia(participant.identity, track.source === Track.Source.ScreenShare ? 'screen' : 'camera', null)
    })
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => useStore.getState().setPeerStatus(p.identity, 'connected'))
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => { useStore.getState().setPeerStatus(p.identity, null); useStore.getState().setSpeaking(p.identity, false) })
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const st = useStore.getState(); const me = st.user?.id
      const ids = new Set(speakers.map((p) => p.identity))
      room.remoteParticipants.forEach((p) => st.setSpeaking(p.identity, ids.has(p.identity)))
      if (me && !ids.has(me) && st.speaking[me]) { /* own speaking comes from the local meter */ }
    })
    room.on(RoomEvent.Disconnected, () => { if (this.room === room) { this.room = null; if (this.channelId) useStore.getState().pushToast('Voice server connection lost', 'error') } })
    try {
      await room.connect(grant.url, grant.token)
      room.remoteParticipants.forEach((p) => useStore.getState().setPeerStatus(p.identity, 'connected'))
      await this.sfuPublishMic()
      if (this.camera) await this.sfuPublish('camera', this.camera.getVideoTracks()[0])
      if (this.screen) await this.sfuPublish('screen', this.screen.getVideoTracks()[0])
    } catch (e) {
      s.pushToast(`Could not join the voice server: ${(e as Error).message}`, 'error')
      await this.disconnectSfu()
      this.leave()
    }
  }

  /** Publish (or republish after a profile change) the mic with the channel's audio profile. */
  private async sfuPublishMic() {
    const room = this.room
    const mic = this.mic?.getAudioTracks()[0]
    if (!room || !mic) return
    if (this.sfuMic) { const old = this.sfuMic; this.sfuMic = null; try { await room.localParticipant.unpublishTrack(old, false) } catch { /* gone */ } }
    const p = this.profile
    const local = new LocalAudioTrack(mic, undefined, false)
    // Music: stereo, no DTX (it gates quiet passages), no RED (doubles a high bitrate). Voice keeps both for robustness.
    await room.localParticipant.publishTrack(local, {
      source: Track.Source.Microphone, audioPreset: { maxBitrate: p.bitrate * 1000, priority: 'high' },
      dtx: p.mode === 'voice', red: p.mode === 'voice' && !p.lowLatency, forceStereo: p.mode === 'music',
    })
    this.sfuMic = local
    if (local.sender) tuneAudioSender(local.sender, p)
  }

  private onSfuTrack(track: RemoteTrack, participant: RemoteParticipant) {
    const userId = participant.identity
    const stream = new MediaStream([track.mediaStreamTrack])
    if (track.kind === Track.Kind.Audio) {
      tuneAudioReceiver(track.receiver, this.profile)
      const s = useStore.getState()
      let el = this.sfuAudio.get(userId)
      if (!el) { el = document.createElement('audio'); el.autoplay = true; el.dataset.peer = userId; document.body.appendChild(el); this.sfuAudio.set(userId, el) }
      el.muted = s.selfDeaf
      this.applyOutput(el)
      el.srcObject = stream
      el.play().catch(() => {})
      this.sfuMeters.get(userId)?.()
      this.sfuMeters.set(userId, this.remoteMeter(stream, userId))
      s.setPeerStatus(userId, 'connected')
      return
    }
    useStore.getState().setRemoteMedia(userId, track.source === Track.Source.ScreenShare ? 'screen' : 'camera', stream)
  }

  private async sfuPublish(kind: 'camera' | 'screen', track: MediaStreamTrack) {
    if (!this.room) return
    await this.sfuUnpublish(kind)
    const local = new LocalVideoTrack(track, undefined, false)
    try {
      await this.room.localParticipant.publishTrack(local, { source: kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera, simulcast: kind === 'camera', videoEncoding: { maxBitrate: kind === 'screen' ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE, maxFramerate: 30 } })
      if (kind === 'screen') this.sfuScreen = local; else this.sfuCamera = local
    } catch (e) { useStore.getState().pushToast(`Could not publish ${kind}: ${(e as Error).message}`, 'error') }
  }

  private async sfuUnpublish(kind: 'camera' | 'screen') {
    const t = kind === 'screen' ? this.sfuScreen : this.sfuCamera
    if (!t) return
    if (kind === 'screen') this.sfuScreen = null; else this.sfuCamera = null
    try { await this.room?.localParticipant.unpublishTrack(t, false) } catch { /* already gone */ }
  }

  private async disconnectSfu() {
    const room = this.room
    this.room = null
    this.sfuCamera = null; this.sfuScreen = null; this.sfuMic = null
    this.sfuAudio.forEach((a) => { a.srcObject = null; a.remove() }); this.sfuAudio.clear()
    this.sfuMeters.forEach((stop) => stop()); this.sfuMeters.clear()
    if (room) { try { await room.disconnect(false) } catch { /* ignore */ } }
  }

  /** RMS voice-activity meter for a remote stream → store.speaking. Returns a stop function. */
  private remoteMeter(stream: MediaStream, userId: string): () => void {
    try {
      const ctx = (this.ctx ??= newAudioContext())
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      let quietSince = 0
      const id = setInterval(() => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const loud = Math.sqrt(sum / buf.length) > 0.02
        const s = useStore.getState()
        const now = Date.now()
        if (loud) { quietSince = 0; s.setSpeaking(userId, true) }
        else if (s.speaking[userId]) { quietSince ||= now; if (now - quietSince > 250) s.setSpeaking(userId, false) }
      }, 100)
      return () => { clearInterval(id); try { src.disconnect() } catch { /* ignore */ } }
    } catch {
      return () => {}
    }
  }
}

export const voice = new VoiceManager()
declare global { interface Window { __parleyVoice?: () => { mode: string; room: string | null; remote: number; channel: string | null } } }
if (typeof window !== 'undefined') window.__parleyVoice = () => voice.debug
/** Debug/test hook: active audio profile, live stats and the Opus parameters each peer negotiated. */
if (typeof window !== 'undefined') (window as unknown as { __parleyAudio: () => Promise<unknown> }).__parleyAudio = () => voice.audioDebug()

// Apply setting changes live.
let prevSettings = useStore.getState().voiceSettings
useStore.subscribe((s) => {
  if (s.voiceSettings !== prevSettings) {
    const prev = prevSettings
    prevSettings = s.voiceSettings
    voice.applySettings(prev)
  }
})

/** 48 kHz interactive context: Opus runs at 48 kHz, so the mic path never resamples. Falls back to the device rate. */
function newAudioContext(): AudioContext {
  try { return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }) } catch { return new AudioContext({ latencyHint: 'interactive' }) }
}
