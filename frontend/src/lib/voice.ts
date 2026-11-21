import { useStore } from '../store'
import { applySfxSink, playSfx } from './sfx'
import type { VoiceState } from './types'
import { startPreviews, stopPreviews } from './streamPreview'
import { sendOp, type SignalData } from './ws'
import { keyLabel, supportsSinkId, type VoiceSettings } from './settings'
import { desktop, desktopBridge } from './desktop'
import { keepAwake } from './native'
import { onUserAudio, userAudio } from './userAudio'
import { api, ApiError } from './api'
import { IDLE, reduce, retryDelay, type CallEvent, type CallReason, type CallState } from './callState'
import { rememberCall } from './callRestore'
import { STORAGE_PREFIX } from './brand'
import { captureConstraints, measure, profileOf, sameProfile, tuneAudioReceiver, tuneAudioSender, tuneOpusSdp, type AudioProfile, type AudioStat } from './audioProfile'
import { DisconnectReason, LocalAudioTrack, LocalVideoTrack, RemoteTrack, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'
import { CallCrypto, e2eeSupported, legacyInsertableStreams, MeshCrypto, ParleyKeyProvider } from './e2ee'
import { CaptionSender, clearCaptions } from './captions'
import { createRnnoise } from './rnnoise'
import { t } from './i18n'

/**
 * Mesh WebRTC voice/video: every participant holds one RTCPeerConnection per other participant.
 * Signaling rides the app WebSocket. Rule to avoid glare: the *joiner* sends offers to everyone
 * already in the channel; existing members only answer.
 *
 * Each connection carries four fixed transceivers negotiated once: [audio, camera, screen, screen audio].
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
  /** Route repairs (ICE restarts) tried since this connection last worked. */
  restarts: number
}

const CAMERA_MAX_BITRATE = 1_500_000
const SCREEN_MAX_BITRATE = 3_000_000
/** Screen share choices: resolution (height; none keeps the source's), frame rate and the bitrate cap that goes with them. */
/** Whether this device can share its screen: phone browsers and the phone apps can't (no getDisplayMedia, or one that
 *  always fails), so they don't offer it. */
export const screenShareSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches)

export const STREAM_QUALITY: Record<string, { label: string; height?: number; fps: number; bitrate: number }> = {
  auto: { label: 'Source resolution, 30 fps (default)', fps: 30, bitrate: SCREEN_MAX_BITRATE },
  '720p30': { label: '720p, 30 fps (saves bandwidth)', height: 720, fps: 30, bitrate: 2_000_000 },
  '1080p30': { label: '1080p, 30 fps', height: 1080, fps: 30, bitrate: 4_000_000 },
  '1080p60': { label: '1080p, 60 fps (smooth motion)', height: 1080, fps: 60, bitrate: 6_000_000 },
  source60: { label: 'Source resolution, 60 fps', fps: 60, bitrate: 8_000_000 },
}
const AUTO_THRESHOLD_DB = -45
const VAD_HOLD_MS = 400
const GATE_INTERVAL_MS = 50

type MicHolder = 'call' | 'test'

/** Fresh STUN/TURN servers before each call: relay logins (Cloudflare TURN) expire, and READY may be days old. Gives up
 *  after a few seconds and keeps the ones from READY, so a slow answer never holds up joining. */
async function refreshIceServers() {
  const fresh = await Promise.race([api.get<RTCIceServer[]>('/voice/ice-servers').catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))])
  if (Array.isArray(fresh) && fresh.length) useStore.setState({ iceServers: fresh })
}

class VoiceManager {
  // mic pipeline
  private raw: MediaStream | null = null       // device stream
  private mic: MediaStream | null = null       // processed stream sent to peers
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private inputGain: GainNode | null = null
  private gate: GainNode | null = null
  /** Studio recording branch: its own mute stage, since it taps the mic before the talk gate. */
  private recGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private gateTimer: ReturnType<typeof setInterval> | null = null
  /** RNNoise between the device and the input gain (Enhanced noise suppression). */
  private ns: AudioWorkletNode | null = null
  private captionSender = new CaptionSender(() => this.mic?.getAudioTracks()[0] ?? null)
  private captionTimer: ReturnType<typeof setInterval> | null = null
  private lastVoiceAt = 0
  /** Last time we were heard in a call (or joined one): the server's inactive timeout counts from here. */
  private lastSpokeAt = Date.now()
  private pttDown = false
  private pttUpAt = 0
  private holders = new Set<MicHolder>()
  /** Audio profile of the channel we are in (or joining); drives capture, Opus parameters and jitter buffers. */
  private profile: AudioProfile = profileOf(null)
  private testAudio: HTMLAudioElement | null = null
  private acquiring: Promise<boolean> | null = null

  private camera: MediaStream | null = null
  private screen: MediaStream | null = null
  /** Mesh: peers who clicked Watch Stream on our screen share; only they are sent its video. */
  private watchers = new Set<string>()
  /** The running screen share's quality (Settings › Voice & Video › Screen share quality). */
  private screenBitrate = SCREEN_MAX_BITRATE
  private screenFps = 30
  /** End-to-end encrypted call (channel `e2ee` on): key agreement, and the mesh frame worker. */
  private crypto: CallCrypto | null = null
  private meshCrypto: MeshCrypto | null = null
  private peers = new Map<string, Peer>()
  private channelId: string | null = null
  private joining = false
  private muteBeforeDeaf = false
  /** The call's connection as the member sees it; every change goes through dispatch(). */
  private call: CallState = IDLE
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private restoreTimer: ReturnType<typeof setInterval> | null = null
  /** What the microphone last refused with, for the failed call's words and the logs. */
  private micError: Error | null = null
  /** Audio devices seen in this call (by group), so one that appears can be offered. */
  private knownDevices: Set<string> | null = null
  /** The last connection events, for Copy Logs. */
  readonly events: string[] = []

  // SFU (LiveKit) transport, used instead of the mesh when the instance has a server configured.
  private room: Room | null = null
  private sfuAudio = new Map<string, HTMLAudioElement>()
  /** Screen share sound (tab or system audio) per streamer: only arrives while you watch their stream. */
  private streamAudio = new Map<string, HTMLAudioElement>()
  private sfuScreenAudio: LocalAudioTrack | null = null
  private sfuMeters = new Map<string, () => void>()
  private sfuCamera: LocalVideoTrack | null = null
  private sfuMic: LocalAudioTrack | null = null
  private sfuScreen: LocalVideoTrack | null = null

  /** Debug/test window: current transport and room state. */
  get debug(): { mode: string; room: string | null; remote: number; channel: string | null; e2ee: boolean } { return { mode: this.sfu ? 'sfu' : 'mesh', room: this.room ? String(this.room.state) : null, remote: this.room?.remoteParticipants.size ?? this.peers.size, channel: this.channelId, e2ee: this.room ? this.room.isE2EEEnabled : !!this.meshCrypto } }
  private get sfu(): boolean { return useStore.getState().instance.voice_mode === 'sfu' }

  constructor() {
    if (typeof window !== 'undefined') {
      onUserAudio(this.reapplyPeople)
      window.addEventListener('keydown', (e) => this.onKey(e, true), true)
      window.addEventListener('keyup', (e) => this.onKey(e, false), true)
      window.addEventListener('blur', () => { this.pttDown = false; useStore.getState().setPttHeld(false) })
      navigator.mediaDevices?.addEventListener?.('devicechange', () => { void this.onDevicesChanged() })
      // Desktop app: the shell watches the key while Parley is in the background, only during a call.
      const shell = window as unknown as { __parleyPtt?: (down: boolean) => void }
      shell.__parleyPtt = (down) => { if (this.settings.inputMode === 'ptt') this.setPtt(!!down) }
      if (desktopBridge()) {
        let watched: string | null = null
        useStore.subscribe((s) => {
          const want = s.myVoiceChannelId && s.voiceSettings.inputMode === 'ptt' ? s.voiceSettings.pttKey : null
          if (want === watched) return
          watched = want
          void desktop.pttKey(want).then((ok) => {
            if (!ok && want && watched === want) useStore.getState().pushToast(navigator.userAgent.includes('Mac') ? t("Push to talk with {key} only works while Parley is in front: the app can't read the keyboard in the background (allow Parley under System Settings → Privacy & Security → Accessibility).", { key: keyLabel(want) }) : t("Push to talk with {key} only works while Parley is in front: the app can't read the keyboard in the background.", { key: keyLabel(want) }), 'error')
          })
        })
      }
      // An admin changing the channel's audio profile mid-call applies to everyone in it without rejoining.
      useStore.subscribe((s, prev) => {
        const id = this.channelId
        if (!id) return
        if (this.syncE2ee()) return
        if (s.channels[id] === prev.channels[id]) return
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
      const sdp = tuneOpusSdp(offer.sdp ?? '', this.profile)
      await peer.pc.setLocalDescription({ type: 'offer', sdp })
      sendOp({ op: 'voice_signal', to, data: { type: 'offer', sdp } })
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

  /** Whether this instance offers a relay (TURN) at all. */
  get hasRelay(): boolean { return useStore.getState().iceServers.some((x) => (Array.isArray(x.urls) ? x.urls : [x.urls]).some((u) => /^turns?:/i.test(u))) }
  /** Direct calls are relayed: the member asked for it and there is a relay to use. */
  get relayed(): boolean { return this.settings.relayOnly && this.hasRelay }
  /** How this call's media travels, for Connection details. */
  get route(): 'server' | 'relayed' | 'direct' { return this.sfu ? 'server' : this.relayed ? 'relayed' : 'direct' }

  /**
   * Joining a direct call: say once that such calls show your IP address to the people in them, with the way to stop
   * that; and say every time when hiding was asked for but this instance has no relay to hide behind.
   */
  private explainRoute() {
    if (this.sfu) return
    const s = useStore.getState()
    if (this.settings.relayOnly) {
      if (!this.hasRelay) s.pushToast(t("This Parley has no relay server, so this call connects directly and the people in it can see your IP address."), 'error')
      return
    }
    if (!this.hasRelay) return
    try { if (localStorage.getItem(DIRECT_SEEN) === '1') return; localStorage.setItem(DIRECT_SEEN, '1') } catch { return }
    s.pushToast(t('Calls here connect directly, so the people in a call can see your IP address.'), 'info', { label: t('Hide my IP address'), run: () => useStore.getState().updateVoiceSettings({ relayOnly: true }) })
  }
  private get settings(): VoiceSettings { return useStore.getState().voiceSettings }

  // ---- public controls ----

  /** `listenOnly`: join even when no microphone can be opened (the call then says there is none, and picks one up when it appears). */
  async join(channelId: string, listenOnly = false) {
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
      const e2ee = !!(s.channels[channelId] ?? s.dms[channelId])?.e2ee
      if (e2ee && !e2eeSupported()) { this.refuseJoin(channelId, 'unsupported', 'no encoded transforms'); return }
      if (!(await this.acquireMic('call', listenOnly))) { this.refuseJoin(channelId, 'microphone', this.micError ? `${this.micError.name}: ${this.micError.message}` : undefined); return }
      await refreshIceServers()
      // Moving channels: tear down old peers; camera/screen stay on and re-attach to new peers.
      if (this.channelId) { this.closeAllPeers(); await this.disconnectSfu() }
      this.endCrypto()
      if (e2ee) await this.startCrypto()
      this.channelId = channelId
      this.lastSpokeAt = Date.now()
      this.dispatch({ type: 'join', channelId })
      s.setMyVoice(channelId, true)
      s.setLocalMedia({ camera: this.camera, screen: this.screen })
      void this.scanDevices(false)
      if (!sendOp({ op: 'voice_join', channel_id: channelId, e2ee: e2eeSupported() })) this.dispatch({ type: 'fail', reason: 'socket', detail: 'no socket at join' })
    } finally {
      this.joining = false
    }
    this.syncE2ee()
  }

  /**
   * Encryption switched on or off for the call we're in (possibly while we were still joining): rejoin so the call is
   * rebuilt, and rekeyed, the new way. Returns true when it started a rejoin.
   */
  private resyncing = false
  private syncE2ee(): boolean {
    const s = useStore.getState()
    const id = this.channelId
    // leave() updates the store (a DM call is marked quiet), which runs this again from the store subscription while
    // the old call is half torn down: without the guard that recursed until the stack overflowed, replaying sounds.
    if (!id || this.joining || this.resyncing) return false
    const e2ee = !!(s.channels[id] ?? s.dms[id])?.e2ee
    if (e2ee === !!this.crypto) return false
    this.resyncing = true
    try { this.leave() } finally { this.resyncing = false }
    void this.join(id)
    s.pushToast(e2ee ? t('This call is now end-to-end encrypted. Reconnecting…') : t('End-to-end encryption was turned off. Reconnecting…'))
    return true
  }

  /**
   * A join that cannot start. Already in another call: say so and stay there. Otherwise the call shows as failed, with
   * the reason and Try again, instead of a message that is gone in four seconds.
   */
  private refuseJoin(channelId: string, reason: CallReason, detail?: string) {
    if (this.channelId) { useStore.getState().pushToast(callFailureText(reason, detail), 'error'); return }
    keepAwake(false)
    this.dispatch({ type: 'join', channelId })
    this.dispatch({ type: 'fail', reason, detail })
  }

  /** Every change of the call's connection state: the store (what the member sees), the log, and what follows from it. */
  private dispatch(e: CallEvent) {
    const prev = this.call
    const next = reduce(prev, e)
    if (next === prev) return
    this.call = next
    this.events.push(`${new Date().toISOString()} ${e.type}${'reason' in e ? ` ${e.reason}` : ''}${'detail' in e && e.detail ? ` (${e.detail})` : ''} → ${next.phase}${next.attempts ? ` #${next.attempts}` : ''}`)
    if (this.events.length > 60) this.events.shift()
    useStore.getState().setCallStatus(next)
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    // A failed call is one we have left: nobody sees us in a call that carries nothing.
    if (next.phase === 'failed' && this.channelId) { this.leave(true, true); return }
    if (next.phase === 'connected' && next.channelId) this.keepRestorable(next.channelId)
    const wait = retryDelay(next)
    if (wait !== null) this.retryTimer = setTimeout(() => { this.retryTimer = null; const id = this.channelId; if (!id) return; this.dispatch({ type: 'retry' }); if (this.sfu) void this.connectSfu(id); else this.onReconnect() }, wait)
  }

  /** While connected, keep "the call this browser is in" fresh for the rejoin offer after a reload (lib/callRestore.ts). */
  private keepRestorable(channelId: string) {
    rememberCall(channelId)
    if (!this.restoreTimer) this.restoreTimer = setInterval(() => { if (this.channelId && this.call.phase !== 'failed') rememberCall(this.channelId) }, 20_000)
  }

  /** Try again from a failed call, or dismiss it. */
  retryCall(listenOnly = false) { const id = this.call.phase === 'failed' ? this.call.channelId : null; if (id) void this.join(id, listenOnly) }
  dismissCall() { if (this.call.phase === 'failed') this.dispatch({ type: 'leave' }) }
  /** Test hook: the transport dropped. */
  dropForTest(detail = 'test') { const room = this.room; if (room) { this.room = null; void room.disconnect(false).catch(() => {}); void this.disconnectSfu() } this.transportLost(detail) }

  leave(evicted = false, keepStatus = false) {
    keepAwake(false)
    this.priorityOn = false
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    if (this.restoreTimer) { clearInterval(this.restoreTimer); this.restoreTimer = null }
    rememberCall(null)
    this.knownDevices = null
    const s = useStore.getState()
    s.setMicLost(false); s.setDeviceOffer(null)
    if (this.channelId) { sendOp({ op: 'voice_leave' }); playSfx(evicted ? 'disconnect' : 'user_leave') }
    // Leaving a DM or group call that's still going must not ring you back in: it stays quiet (rejoin from the DM)
    // until it ends.
    if (this.channelId && s.dms[this.channelId]) s.setCallIgnored(this.channelId, true)
    if (this.captionTimer) { clearInterval(this.captionTimer); this.captionTimer = null }
    this.captionSender.stop(); clearCaptions()
    this.channelId = null
    this.closeAllPeers()
    this.disconnectSfu()
    this.endCrypto()
    this.releaseMic('call')
    this.stopTracks(this.camera); this.camera = null
    this.stopTracks(this.screen); this.screen = null
    s.setMyVoice(null)
    if (!keepStatus) this.dispatch({ type: 'leave' })
  }

  /** Priority Speaker switched on (needs the permission; the server ignores it otherwise). */
  priorityOn = false
  setPriority(on: boolean) { this.priorityOn = on; this.pushState() }

  /** Live captions for yourself in this call (remembered for the next call). */
  setCaptions(on: boolean) {
    try { localStorage.setItem('parley.captions', on ? '1' : '0') } catch { /* ignore */ }
    if (!on) clearCaptions()
    sendOp({ op: 'voice_captions', on })
  }
  captionsWanted() { try { return localStorage.getItem('parley.captions') === '1' } catch { return false } }

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
      this.watchers.clear()
      this.peers.forEach((p) => { this.replaceVideo(p.pc, 1, null); this.replaceScreenAudio(p.pc, null) })
      await this.sfuUnpublish('screen')
      s.setLocalMedia({ screen: null })
      stopPreviews()
      playSfx('stream_stopped')
      this.pushState()
      return
    }
    const stream = await this.pickScreen()
    if (!stream) return
    playSfx('stream_started')
    await this.showScreen(stream)
    this.pushState()
  }

  /** The browser's picker, asked for the chosen quality and (unless switched off) the source's sound. Null when cancelled or refused. */
  private async pickScreen(): Promise<MediaStream | null> {
    const s = useStore.getState()
    if (!navigator.mediaDevices?.getDisplayMedia) { s.pushToast(t('Screen sharing is not supported in this browser'), 'error'); return null }
    try {
      const q = STREAM_QUALITY[this.settings.streamQuality] ?? STREAM_QUALITY.auto
      this.screenBitrate = q.bitrate; this.screenFps = q.fps
      const sound = this.settings.streamAudio !== false
      return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: q.fps, max: q.fps }, ...(q.height ? { height: { ideal: q.height, max: q.height } } : {}) }, audio: sound ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false, ...(sound ? { systemAudio: 'include' } : {}) } as DisplayMediaStreamOptions)
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') s.pushToast(t('Screen share failed: {error}', { error: (e as Error).message }), 'error')
      return null
    }
  }

  /** Put a picked screen on the air: to the peers watching, to the media server, to our own tile and the previews. */
  private async showScreen(stream: MediaStream) {
    this.screen = stream
    const track = stream.getVideoTracks()[0]
    // Browser "Stop sharing" button ends the track.
    track.onended = () => { if (this.screen === stream) this.toggleScreen() }
    this.peers.forEach((p, id) => { this.replaceVideo(p.pc, 1, this.screenFor(id)); this.replaceScreenAudio(p.pc, this.screenAudioFor(id)) })
    await this.sfuPublish('screen', track)
    useStore.getState().setLocalMedia({ screen: stream })
    if (this.channelId) startPreviews(this.channelId, track)
  }

  /** Share something else without stopping: viewers keep watching and see the new source. Cancelling the picker changes nothing. */
  async changeScreen() {
    if (!this.screen) return
    const stream = await this.pickScreen()
    if (!stream || !this.screen) { this.stopTracks(stream); return }
    const old = this.screen
    stopPreviews()
    await this.showScreen(stream)
    this.stopTracks(old)
  }

  /** What is going out: the shared picture's size and frame rate, and whether its sound is shared. */
  get screenInfo(): { width: number; height: number; fps: number; sound: boolean } | null {
    const track = this.screen?.getVideoTracks()[0]
    if (!track) return null
    const st = track.getSettings()
    return { width: st.width ?? 0, height: st.height ?? 0, fps: Math.round(st.frameRate ?? this.screenFps), sound: !!this.screen?.getAudioTracks().length }
  }

  /** A quality chosen while sharing takes effect on the running share: the capture's size and frame rate, and the bitrate cap. */
  private async applyStreamQuality() {
    const track = this.screen?.getVideoTracks()[0]
    if (!track) return
    const q = STREAM_QUALITY[this.settings.streamQuality] ?? STREAM_QUALITY.auto
    this.screenBitrate = q.bitrate; this.screenFps = q.fps
    try { await track.applyConstraints({ frameRate: { ideal: q.fps, max: q.fps }, ...(q.height ? { height: { ideal: q.height, max: q.height } } : {}) }) } catch { /* the source can't do it: the bitrate cap still applies */ }
    this.peers.forEach((p, id) => this.replaceVideo(p.pc, 1, this.screenFor(id)))
    const sender = this.sfuScreen?.sender
    if (sender) { const params = sender.getParameters(); if (params.encodings?.length) { params.encodings[0].maxBitrate = q.bitrate; params.encodings[0].maxFramerate = q.fps; sender.setParameters(params).catch(() => {}) } }
    useStore.getState().setLocalMedia({ screen: this.screen })
  }

  // ---- settings ----

  /** Called after the store's voiceSettings change; applies whatever changed live. */
  async applySettings(prev: VoiceSettings) {
    const cur = this.settings
    if (this.inputGain) this.inputGain.gain.value = cur.inputVolume / 100
    if (prev.outputDeviceId !== cur.outputDeviceId || prev.outputVolume !== cur.outputVolume) { this.peers.forEach((p) => this.applyOutput(p.audio)); this.sfuAudio.forEach((a) => this.applyOutput(a)); this.streamAudio.forEach((a) => this.applyOutput(a)); applySfxSink(cur.outputDeviceId) }
    const micChanged = prev.inputDeviceId !== cur.inputDeviceId || prev.echoCancellation !== cur.echoCancellation
      || prev.noiseSuppression !== cur.noiseSuppression || prev.autoGainControl !== cur.autoGainControl || prev.noiseSuppressionMode !== cur.noiseSuppressionMode
    if (micChanged && (this.raw || useStore.getState().micLost) && this.ctx && !this.recovering) await this.reopenMicDevice()
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
    if (prev.streamQuality !== cur.streamQuality && this.screen) await this.applyStreamQuality()
    // Hiding (or showing) the IP address takes new connections: rebuild the direct ones now, not at the next call.
    if (prev.relayOnly !== cur.relayOnly && this.channelId && !this.sfu && this.hasRelay && this.peers.size) this.onReconnect()
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
    // A voice channel set to Full quality asks for 1080p; otherwise (and in DMs and the settings preview) 720p.
    const full = !!this.channelId && useStore.getState().channels[this.channelId]?.video_quality === 'full'
    const video: MediaTrackConstraints = full ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    if (id) video.deviceId = { exact: id }
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false })
    } catch (e) {
      if (id) {
        // Chosen device vanished: fall back to default and forget the choice.
        useStore.getState().updateVoiceSettings({ cameraDeviceId: '' })
        try { return await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined }, audio: false }) } catch { /* fallthrough */ }
      }
      useStore.getState().pushToast(deviceErrorText('camera', e as Error), 'error')
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
          if (this.captionsWanted()) sendOp({ op: 'voice_captions', on: true })
          if (!this.captionTimer) this.captionTimer = setInterval(() => this.captionSender.tick(), 1000)
          playSfx('user_join')
          if (this.sfu) {
            this.connectSfu(this.channelId)
          } else {
            const others = Object.values(s.voiceStates).filter((o) => o.channel_id === this.channelId && o.user_id !== me)
            if (others.length && this.call.phase === 'connecting') this.explainRoute()
            others.forEach((o) => { if (!this.peers.has(o.user_id)) this.offerTo(o.user_id) })
            // Mesh has no one transport: the server placing us in the call is the call being up.
            this.dispatch({ type: 'up' })
          }
          if (this.camera || this.screen || s.selfMute || s.selfDeaf) this.pushState()
        }
        // A moderator's server deafen (or its removal) takes effect on what we hear right away.
        this.applyDeaf(useStore.getState().selfDeaf)
      } else if (v.channel_id === null && !useStore.getState().voiceConnecting) {
        // Server evicted us (kicked, channel deleted, another tab took over). While a (re)join awaits its
        // acknowledgement, a "left" state is the echo of our own earlier voice_leave, not an eviction.
        this.leave(true)
      }
      return
    }
    if (v.channel_id !== this.channelId && this.peers.has(v.user_id)) this.closePeer(v.user_id)
    // They stopped sharing or left: the next share needs another Watch Stream click, as in Discord.
    if ((!v.self_stream || v.channel_id !== this.channelId) && useStore.getState().watching[v.user_id]) useStore.getState().setWatching(v.user_id, false)
  }

  async onSignal(from: string, channelId: string, data: SignalData) {
    if (channelId !== this.channelId) return
    if (data.type === 'e2ee_hello' || data.type === 'e2ee_key') { this.crypto?.onSignal(from, data); return }
    if (this.sfu) return
    if (data.type === 'watch') {
      if (data.on) this.watchers.add(from); else this.watchers.delete(from)
      const p = this.peers.get(from)
      if (p) { this.replaceVideo(p.pc, 1, this.screenFor(from)); this.replaceScreenAudio(p.pc, this.screenAudioFor(from)) }
      return
    }
    const peer = this.peers.get(from) ?? this.createPeer(from, false)
    try {
      if (data.type === 'offer') {
        // A renegotiation offer can beat our own CHANNEL_UPDATE: answer with the channel's current profile.
        const fresh = this.profileFor(channelId)
        if (!sameProfile(fresh, this.profile)) await this.applyProfile(fresh)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        this.attachLocalTracks(peer.pc, from)
        await this.flushCandidates(peer)
        // The tuned SDP goes into our own local description too: libwebrtc configures the receiving Opus decoder
        // from it, so without stereo=1 there a stereo stream is decoded (and played) as mono.
        const answer = await peer.pc.createAnswer()
        const sdp = tuneOpusSdp(answer.sdp ?? '', this.profile)
        await peer.pc.setLocalDescription({ type: 'answer', sdp })
        sendOp({ op: 'voice_signal', to: from, data: { type: 'answer', sdp } })
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
      sendOp({ op: 'voice_join', channel_id: ch, e2ee: e2eeSupported() })
    }
  }

  /** Back from the background (phones): the OS may have ended the mic or camera and suspended audio. Reopen the mic,
   *  drop a dead camera and start playback again, so a call that survived (or rejoined) is heard both ways. */
  /** Tests: the device mic track's id and state, and ending it as a phone OS does to a backgrounded app. */
  get micDebug() { const tr = this.raw?.getAudioTracks()[0]; return { id: tr?.id ?? null, state: tr?.readyState ?? null } }
  endMicForTest() { this.raw?.getAudioTracks()[0]?.stop() }
  /** Tests: the microphone unplugged while the page is in front (the track stops and says so). */
  unplugMicForTest() { const tr = this.raw?.getAudioTracks()[0]; if (tr) { tr.stop(); tr.dispatchEvent(new Event('ended')) } }

  async resumeAfterBackground() {
    if (!this.channelId) return
    const mic = this.raw?.getAudioTracks()[0]
    if (this.raw && (!mic || mic.readyState === 'ended')) await this.recoverMic(false)
    const cam = this.camera?.getVideoTracks()[0]
    if (this.camera && cam?.readyState === 'ended') this.toggleCamera()
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {})
    this.peers.forEach((p) => { if (p.audio.paused) void p.audio.play().catch(() => {}) })
    this.sfuAudio.forEach((a) => { if (a.paused) void a.play().catch(() => {}) })
  }

  onSocketLost() {
    if (this.channelId) { useStore.getState().setMyVoice(this.channelId, true); this.dispatch({ type: 'lost', reason: 'socket', now: Date.now() }) }
  }

  /** The media server dropped the call, or could not be reached: reconnect, a few times (lib/callState.ts). */
  private transportLost(detail: string) {
    if (!this.channelId) return
    this.dispatch({ type: 'lost', reason: 'transport', detail, now: Date.now() })
  }

  // ---- mic pipeline ----

  private micConstraints(): MediaStreamConstraints {
    const st = this.settings
    // Enhanced suppression replaces the browser's: running both muffles speech.
    const audio: MediaTrackConstraints = captureConstraints(this.profile, { ...st, noiseSuppression: st.noiseSuppression && st.noiseSuppressionMode !== 'enhanced' })
    if (st.inputDeviceId) audio.deviceId = { exact: st.inputDeviceId }
    return { audio, video: false }
  }

  private async getRawMic(quiet = false): Promise<MediaStream | null> {
    const s = useStore.getState()
    this.micError = null
    if (!navigator.mediaDevices?.getUserMedia) {
      s.pushToast(window.isSecureContext
        ? t('This browser does not support microphone capture')
        : t('Microphone needs a secure context. Open the app over HTTPS (e.g. https://{host}:3443) or via localhost.', { host: location.hostname }), 'error')
      return null
    }
    try {
      return await navigator.mediaDevices.getUserMedia(this.micConstraints())
    } catch (e) {
      if (this.settings.inputDeviceId) {
        s.updateVoiceSettings({ inputDeviceId: '' })
        try { return await navigator.mediaDevices.getUserMedia(this.micConstraints()) } catch { /* fallthrough */ }
      }
      this.micError = e as Error
      // A call says why it could not start where the call is shown; the settings' microphone test says it here.
      if (!quiet) s.pushToast(t('Microphone unavailable: {error}', { error: (e as Error).message }), 'error')
      return null
    }
  }

  /** The device stopped giving sound (unplugged, taken away by the system): recover when it does, while the page is in front. */
  private watchMic(raw: MediaStream) {
    const track = raw.getAudioTracks()[0]
    if (track) track.onended = () => { if (this.raw === raw && document.visibilityState !== 'hidden') void this.recoverMic(true) }
  }

  /** Open a microphone again after losing one: the chosen device if it is back, else the default. Says what happened. */
  private recovering: Promise<void> | null = null
  recoverMic(announce = true): Promise<void> {
    if (this.recovering) return this.recovering
    this.recovering = (async () => {
      if (!this.holders.size || !this.ctx) return
      const s = useStore.getState()
      const ok = await this.reopenMicDevice(true)
      s.setMicLost(!ok)
      if (ok && announce && this.channelId) {
        const label = this.raw?.getAudioTracks()[0]?.label
        s.pushToast(label ? t('Your microphone was disconnected. Now using {device}.', { device: label }) : t('Your microphone was disconnected. Now using another one.'))
      }
    })().finally(() => { this.recovering = null })
    return this.recovering
  }

  /** Devices came or went. A lost microphone may be back; a new one is offered once (not while several arrive together, as with a dock). */
  private async onDevicesChanged() {
    if (!this.channelId) return
    if (useStore.getState().micLost) await this.recoverMic(false)
    await this.scanDevices(true)
  }

  private async scanDevices(offer: boolean) {
    let list: MediaDeviceInfo[]
    try { list = await navigator.mediaDevices.enumerateDevices() } catch { return }
    const groups = new Map<string, { label: string; inputId: string | null; outputId: string | null }>()
    for (const d of list) {
      if ((d.kind !== 'audioinput' && d.kind !== 'audiooutput') || !d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue
      const key = d.groupId || d.deviceId
      const g = groups.get(key) ?? { label: '', inputId: null, outputId: null }
      if (d.kind === 'audioinput') { g.inputId = d.deviceId; g.label = d.label || g.label } else { g.outputId = d.deviceId; g.label ||= d.label }
      groups.set(key, g)
    }
    const known = this.knownDevices
    this.knownDevices = new Set(groups.keys())
    const s = useStore.getState()
    // An offer for a device that has gone again goes with it.
    if (s.deviceOffer && !groups.has(s.deviceOffer.groupId)) s.setDeviceOffer(null)
    if (!offer || !known || !this.channelId) return
    const fresh = [...groups.entries()].filter(([key, g]) => !known.has(key) && g.label && !ignoredDevices().includes(g.label))
    if (fresh.length !== 1) return
    const [groupId, g] = fresh[0]
    if (g.inputId && g.inputId === this.settings.inputDeviceId) return
    s.setDeviceOffer({ groupId, ...g })
  }

  /** The offered device: use it for this and later calls, leave it this time, or never offer it again. */
  acceptDevice() {
    const s = useStore.getState(); const o = s.deviceOffer
    if (!o) return
    s.updateVoiceSettings({ ...(o.inputId ? { inputDeviceId: o.inputId } : {}), ...(o.outputId && supportsSinkId ? { outputDeviceId: o.outputId } : {}) })
    s.setDeviceOffer(null)
  }
  declineDevice(forever = false) {
    const s = useStore.getState(); const o = s.deviceOffer
    if (o && forever) { try { localStorage.setItem(IGNORED_DEVICES, JSON.stringify([...new Set([...ignoredDevices(), o.label])].slice(-40))) } catch { /* private mode */ } }
    s.setDeviceOffer(null)
  }

  private acquireMic(holder: MicHolder, allowNone = false): Promise<boolean> {
    this.holders.add(holder)
    if (this.mic) return Promise.resolve(true)
    if (this.acquiring) return this.acquiring
    this.acquiring = (async () => {
      const raw = await this.getRawMic(holder === 'call')
      if (!raw && !allowNone) { this.holders.delete(holder); return false }
      if (!this.holders.size) { this.stopTracks(raw); return false } // released while waiting
      // Without a microphone (listen only) the same pipeline runs with nothing feeding it, so one that appears later
      // is wired in like a replaced device.
      this.raw = raw
      if (raw) this.watchMic(raw); else useStore.getState().setMicLost(true)
      const ctx = (this.ctx ??= newAudioContext())
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      this.inputGain = ctx.createGain(); this.inputGain.gain.value = this.settings.inputVolume / 100
      this.gate = ctx.createGain(); this.gate.gain.value = 0
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024
      this.dest = ctx.createMediaStreamDestination()
      this.source = raw ? ctx.createMediaStreamSource(raw) : null
      await this.wireSource()
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
    if (this.ns) { this.ns.disconnect(); (this.ns as AudioWorkletNode & { destroy?: () => void }).destroy?.(); this.ns = null }
    this.source = this.inputGain = this.gate = this.analyser = this.dest = null
    this.stopTracks(this.raw); this.raw = null
    this.stopTracks(this.mic); this.mic = null
    this.ctx?.close().catch(() => {}); this.ctx = null
    const s = useStore.getState()
    s.setInputLevel(-100, false)
    if (s.user) s.setSpeaking(s.user.id, false)
  }

  /** Swap the capture device under the running pipeline; the outgoing track is unchanged. */
  private async reopenMicDevice(quiet = false): Promise<boolean> {
    const raw = await this.getRawMic(quiet)
    if (!raw || !this.ctx || !this.inputGain) { if (raw) this.stopTracks(raw); return false }
    this.source?.disconnect()
    this.stopTracks(this.raw)
    this.raw = raw
    this.watchMic(raw)
    this.source = this.ctx.createMediaStreamSource(raw)
    await this.wireSource()
    useStore.getState().setMicLost(false)
    return true
  }

  /** device → (RNNoise, when Enhanced suppression is on and can run) → input gain. */
  private async wireSource() {
    const ctx = this.ctx, source = this.source, gain = this.inputGain
    if (!ctx || !source || !gain) return
    const want = this.settings.noiseSuppression && this.settings.noiseSuppressionMode === 'enhanced' && this.profile.mode !== 'music'
    if (want && !this.ns) this.ns = await createRnnoise(ctx)
    if (!want && this.ns) { this.ns.disconnect(); (this.ns as AudioWorkletNode & { destroy?: () => void }).destroy?.(); this.ns = null }
    if (this.source !== source) return // replaced while loading
    source.disconnect()
    if (this.ns) { this.ns.disconnect(); source.connect(this.ns); this.ns.connect(gain) } else source.connect(gain)
    useStore.getState().setNoiseEngine(this.ns ? 'enhanced' : this.settings.noiseSuppression ? 'standard' : 'off')
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
      // Server-side "suppress" (no SPEAK permission) and a moderator's server mute or deafen keep the gate shut.
      if (this.serverSilenced()) open = false
      gate.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, 0.015)
      const muted = s.selfMute || s.selfDeaf
      s.setInputLevel(Math.round(db), open && !muted)
      if (this.recGain) this.recGain.gain.setTargetAtTime(this.recordingSilenced() ? 0 : 1, ctx.currentTime, 0.015)
      if (open && !muted && db > -60) this.lastSpokeAt = now
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
    this.setPtt(down)
  }

  private setPtt(down: boolean) {
    if (this.pttDown !== down) playSfx(down ? 'ptt_activate' : 'ptt_deactivate')
    this.pttDown = down
    if (!down) this.pttUpAt = Date.now()
    useStore.getState().setPttHeld(down)
  }

  /** Studio recording: the microphone after input volume but before the talk gate, so takes are never clipped by VAD/PTT. */
  getRecordingStream(): MediaStream | null {
    if (this.ctx && this.inputGain) {
      this.releaseRecordingStream()
      const dest = this.ctx.createMediaStreamDestination()
      // Muting (or being server-muted) silences the take too; the gate loop keeps this in step.
      this.recGain = this.ctx.createGain(); this.recGain.gain.value = this.recordingSilenced() ? 0 : 1
      this.inputGain.connect(this.recGain).connect(dest)
      return dest.stream
    }
    return this.raw ?? this.mic
  }

  releaseRecordingStream() { this.recGain?.disconnect(); this.recGain = null }

  /** Clips: the call's sound playing here (each person, and the stream sound you're watching), and your own voice as
   *  the others hear it. */
  clipAudio(): { remote: MediaStream[]; mine: MediaStream | null } {
    const remote: MediaStream[] = []
    const add = (el?: HTMLAudioElement | null) => { const st = el?.srcObject; if (st instanceof MediaStream && st.getAudioTracks().some((tr) => tr.readyState === 'live')) remote.push(st) }
    this.peers.forEach((p) => add(p.audio)); this.sfuAudio.forEach(add); this.streamAudio.forEach(add)
    return { remote, mine: this.mic }
  }

  /** Studio takes: whether the call's microphone path changes the sound (echo cancellation, noise suppression, gain control). */
  get micProcessed() {
    const st = this.settings
    return this.profile.mode !== 'music' && !!(st.echoCancellation || st.noiseSuppression || st.autoGainControl)
  }
  /** The input device the call uses ('' for the system's default). */
  get inputDeviceId() { return this.settings.inputDeviceId || '' }

  /** Muted here or by the server: a take recorded from the microphone is silent meanwhile. */
  recordingSilenced() {
    const s = useStore.getState()
    return s.selfMute || s.selfDeaf || this.serverSilenced()
  }
  /** The server keeps us quiet: no Speak (or stage audience), or a moderator's server mute or deafen. */
  private serverSilenced() {
    const s = useStore.getState()
    const v = s.user ? s.voiceStates[s.user.id] : undefined
    return !!(v?.suppress || v?.mute || v?.deaf) || this.inAfkChannel()
  }
  private inAfkChannel() {
    const s = useStore.getState()
    const g = this.channelId ? s.guilds[s.channels[this.channelId]?.guild_id ?? ''] : undefined
    return !!g?.afk_channel_id && g.afk_channel_id === this.channelId
  }

  /** Server inactive channel: after `afk_timeout` seconds without being heard, move there (like Discord's AFK channel). */
  checkAfk(now = Date.now()) {
    const s = useStore.getState()
    if (!this.channelId || this.joining) return false
    const g = s.guilds[s.channels[this.channelId]?.guild_id ?? '']
    if (!g?.afk_channel_id || g.afk_channel_id === this.channelId || !s.channels[g.afk_channel_id]) return false
    if (now - this.lastSpokeAt < (g.afk_timeout ?? 300) * 1000) return false
    s.pushToast(t('You were moved to {channel} for being inactive', { channel: s.channels[g.afk_channel_id].name }))
    void this.join(g.afk_channel_id)
    return true
  }
  /** A moderator server-deafened us: we hear nobody until they lift it. */
  private serverDeaf() {
    const s = useStore.getState()
    return !!(s.user && s.voiceStates[s.user.id]?.deaf)
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

  /** A priority speaker in our channel who is talking right now (not us), if any. */
  priorityTalking(): string | null {
    const s = useStore.getState()
    if (!this.channelId) return null
    for (const v of Object.values(s.voiceStates)) if (v.priority && v.channel_id === this.channelId && v.user_id !== s.user?.id && s.speaking[v.user_id]) return v.user_id
    return null
  }
  /** Re-apply volumes (ducking changed). */
  reapplyVolumes() { this.reapplyPeople() }

  private applyOutput(el: HTMLAudioElement) {
    const st = this.settings
    // A person's own volume (set in their user menu) scales the output volume; sounds have no data-peer.
    const who = el.dataset.peer ? userAudio(el.dataset.peer) : null
    // Priority speaker: while someone with it is talking here, everyone else is turned down to a quarter.
    const duck = el.dataset.peer && this.priorityTalking() && this.priorityTalking() !== el.dataset.peer ? 0.25 : 1
    el.volume = Math.max(0, Math.min(1, (st.outputVolume / 100) * ((who?.volume ?? 100) / 100) * duck))
    el.muted = useStore.getState().selfDeaf || this.serverDeaf() || !!who?.muted
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
    sendOp({ op: 'voice_state', self_mute: s.selfMute, self_deaf: s.selfDeaf, self_video: !!this.camera, self_stream: !!this.screen, priority: this.priorityOn })
  }

  private async offerTo(userId: string) {
    const peer = this.createPeer(userId, true)
    try {
      const offer = await peer.pc.createOffer()
      const sdp = tuneOpusSdp(offer.sdp ?? '', this.profile)
      await peer.pc.setLocalDescription({ type: 'offer', sdp })
      sendOp({ op: 'voice_signal', to: userId, data: { type: 'offer', sdp } })
    } catch (e) {
      console.warn('offer failed', e)
      useStore.getState().setPeerStatus(userId, 'failed')
    }
  }

  private createPeer(userId: string, offerer: boolean): Peer {
    const s = useStore.getState()
    // "Hide my IP address": only relayed routes are tried, so the other side sees the relay's address, never ours.
    const pc = new RTCPeerConnection({ iceServers: s.iceServers, ...(this.relayed ? { iceTransportPolicy: 'relay' } : {}), ...(this.meshCrypto && legacyInsertableStreams() ? { encodedInsertableStreams: true } : {}) } as RTCConfiguration)
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.muted = s.selfDeaf
    audio.dataset.peer = userId
    document.body.appendChild(audio)
    this.applyOutput(audio)
    const peer: Peer = { pc, audio, pendingCandidates: [], offerer, restarts: 0 }
    this.peers.set(userId, peer)
    s.setPeerStatus(userId, 'connecting')

    if (offerer) {
      // Fixed m-line layout; the answerer mirrors it by order.
      pc.addTransceiver(this.mic!.getAudioTracks()[0], { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      this.replaceVideo(pc, 0, this.camera?.getVideoTracks()[0] ?? null)
      this.replaceVideo(pc, 1, this.screenFor(userId))
      this.replaceScreenAudio(pc, this.screenAudioFor(userId))
      this.meshCrypto?.secure(pc, userId)
    }
    this.crypto?.hello(userId)

    pc.onicecandidate = (e) => sendOp({ op: 'voice_signal', to: userId, data: { type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null } })
    pc.ontrack = (e) => {
      this.meshCrypto?.secure(pc, userId)
      const stream = new MediaStream([e.track])
      if (e.track.kind === 'audio' && this.audioTransceivers(pc).indexOf(e.transceiver) === 1) { this.playStream(userId, stream); return }
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
      if (st === 'connected') {
        useStore.getState().setPeerStatus(userId, 'connected'); this.tunePeer(pc); peer.restarts = 0
        // A new connection to someone we were watching (they or we reconnected): ask for their screen again.
        if (useStore.getState().watching[userId]) sendOp({ op: 'voice_signal', to: userId, data: { type: 'watch', on: true } })
      }
      else if (st === 'failed') { useStore.getState().setPeerStatus(userId, 'failed'); this.repairPeer(userId, peer) }
      else if (st === 'disconnected') useStore.getState().setPeerStatus(userId, 'connecting')
    }
    return peer
  }

  /**
   * The route to someone stopped working: whoever made the first offer makes a new one that looks for a fresh route
   * (an ICE restart), a few times with a growing pause. The other side answers it like any renegotiation.
   */
  private repairPeer(userId: string, peer: Peer) {
    if (!peer.offerer || peer.restarts >= 3) return
    const n = ++peer.restarts
    this.events.push(`${new Date().toISOString()} route to ${userId.slice(-6)} failed, repair #${n}`)
    setTimeout(async () => {
      if (this.peers.get(userId) !== peer || peer.pc.connectionState === 'connected' || peer.pc.signalingState !== 'stable') return
      try {
        const offer = await peer.pc.createOffer({ iceRestart: true })
        const sdp = tuneOpusSdp(offer.sdp ?? '', this.profile)
        await peer.pc.setLocalDescription({ type: 'offer', sdp })
        sendOp({ op: 'voice_signal', to: userId, data: { type: 'offer', sdp } })
      } catch (e) { console.warn('route repair failed', e) }
    }, 1000 * n)
  }

  /** Answerer side: mirror the offerer's [audio, camera, screen] layout with our own tracks. */
  private attachLocalTracks(pc: RTCPeerConnection, userId: string) {
    const ts = pc.getTransceivers()
    const audio = ts.find((t) => t.receiver.track.kind === 'audio')
    if (audio) { audio.direction = 'sendrecv'; audio.sender.replaceTrack(this.mic?.getAudioTracks()[0] ?? null).catch(() => {}) }
    const videos = this.videoTransceivers(pc)
    videos.forEach((t) => (t.direction = 'sendrecv'))
    this.replaceVideo(pc, 0, this.camera?.getVideoTracks()[0] ?? null)
    this.replaceVideo(pc, 1, this.screenFor(userId))
    const sa = this.audioTransceivers(pc)[1]
    if (sa) sa.direction = 'sendrecv'
    this.replaceScreenAudio(pc, this.screenAudioFor(userId))
    this.meshCrypto?.secure(pc, userId)
  }

  /** Our screen share track for one peer: only peers watching it get the video, like Discord's Watch Stream. */
  private screenFor(userId: string): MediaStreamTrack | null {
    return this.watchers.has(userId) ? this.screen?.getVideoTracks()[0] ?? null : null
  }

  /**
   * Start or stop watching someone's screen share. Until you watch, their video isn't sent to you (mesh: the streamer
   * holds it back; SFU: the track stays unsubscribed), which saves bandwidth for everyone not looking at it.
   */
  watch(userId: string, on: boolean) {
    useStore.getState().setWatching(userId, on)
    this.announceWatch(userId, on)
    if (this.sfu) { this.sfuScreenPub(userId)?.setSubscribed(on); this.room?.remoteParticipants.get(userId)?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(on); return }
    sendOp({ op: 'voice_signal', to: userId, data: { type: 'watch', on } })
  }
  /** Tell the server who we watch (viewer lists); separate from the media plumbing above. */
  private announceWatch(userId: string, on: boolean) { sendOp({ op: 'stream_watch', user_id: userId, on }) }

  /** The screen's sound goes to the same people as its picture. */
  private screenAudioFor(userId: string): MediaStreamTrack | null {
    return this.watchers.has(userId) ? this.screen?.getAudioTracks()[0] ?? null : null
  }

  private audioTransceivers(pc: RTCPeerConnection) {
    return pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio')
  }

  private replaceScreenAudio(pc: RTCPeerConnection, track: MediaStreamTrack | null) {
    this.audioTransceivers(pc)[1]?.sender.replaceTrack(track).catch(() => {})
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
      params.encodings[0].maxBitrate = slot === 1 ? this.screenBitrate : CAMERA_MAX_BITRATE
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
    this.playStream(userId, null)
    this.peers.delete(userId)
    this.watchers.delete(userId)
    this.crypto?.remove(userId)
    const s = useStore.getState()
    s.setPeerStatus(userId, null)
    s.setSpeaking(userId, false)
  }

  private closeAllPeers() { [...this.peers.keys()].forEach((id) => this.closePeer(id)) }

  private stopTracks(stream: MediaStream | null) { stream?.getTracks().forEach((t) => { t.onended = null; t.stop() }) }
  private applyMute(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted))
    if (this.recGain && this.ctx) this.recGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.015)
  }
  private applyDeaf(selfDeaf: boolean) {
    const deaf = selfDeaf || this.serverDeaf()
    const muted = (el: HTMLAudioElement) => deaf || (!!el.dataset.peer && userAudio(el.dataset.peer).muted)
    this.peers.forEach((p) => (p.audio.muted = muted(p.audio))); this.sfuAudio.forEach((a) => (a.muted = muted(a))); this.streamAudio.forEach((a) => (a.muted = muted(a)))
  }
  /** Someone's volume or local mute changed in their user menu: apply it to whatever is playing them. */
  private reapplyPeople = () => { this.peers.forEach((p) => this.applyOutput(p.audio)); this.sfuAudio.forEach((a) => this.applyOutput(a)); this.streamAudio.forEach((a) => this.applyOutput(a)) }

  /** Play (or stop, with null) someone's screen share sound; follows deafen, output device and their volume. */
  private playStream(userId: string, stream: MediaStream | null) {
    let el = this.streamAudio.get(userId)
    if (!stream) { if (el) { el.srcObject = null; el.remove(); this.streamAudio.delete(userId) } return }
    if (!el) { el = document.createElement('audio'); el.autoplay = true; el.dataset.peer = userId; el.dataset.streamAudio = userId; document.body.appendChild(el); this.streamAudio.set(userId, el) }
    const s = useStore.getState()
    el.muted = s.selfDeaf || this.serverDeaf() || userAudio(userId).muted
    this.applyOutput(el)
    el.srcObject = stream
    el.play().catch(() => {})
  }

  // ---- SFU (LiveKit) ----

  private async connectSfu(channelId: string) {
    const s = useStore.getState()
    if (this.room) await this.disconnectSfu()
    let grant: { url: string; token: string }
    try { grant = await api.post<{ url: string; token: string }>('/voice/token', { channel_id: channelId }) } catch (e) {
      // The server answering no (full, no permission) is final; not being able to ask is worth another try.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) this.dispatch({ type: 'fail', reason: 'refused', detail: e.message })
      else this.transportLost(`token: ${(e as Error).message}`)
      return
    }
    if (this.channelId !== channelId) return
    const keys = this.crypto && s.user ? new ParleyKeyProvider(s.user.id) : null
    const room = new Room({ adaptiveStream: true, dynacast: true, ...(keys ? { e2ee: { keyProvider: keys, worker: new E2EEWorker() } } : {}) })
    if (keys) this.crypto!.attach(keys)
    this.room = room
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => this.onSfuTrack(track, participant))
    // Screen shares are only subscribed once you click Watch Stream; everything else as soon as it is published.
    room.on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, participant: RemoteParticipant) => this.sfuAutoSubscribe(pub, participant))
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.source === Track.Source.ScreenShareAudio) { this.playStream(participant.identity, null); return }
      if (track.kind === Track.Kind.Audio) { this.sfuAudio.get(participant.identity)?.remove(); this.sfuAudio.delete(participant.identity); this.sfuMeters.get(participant.identity)?.(); this.sfuMeters.delete(participant.identity) }
      else useStore.getState().setRemoteMedia(participant.identity, track.source === Track.Source.ScreenShare ? 'screen' : 'camera', null)
    })
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => { useStore.getState().setPeerStatus(p.identity, 'connected'); this.crypto?.hello(p.identity) })
    // Encrypted calls move to a new sender key when someone leaves, so they can't decrypt what follows.
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => { useStore.getState().setPeerStatus(p.identity, null); useStore.getState().setSpeaking(p.identity, false); this.crypto?.remove(p.identity, true) })
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const st = useStore.getState(); const me = st.user?.id
      const ids = new Set(speakers.map((p) => p.identity))
      room.remoteParticipants.forEach((p) => st.setSpeaking(p.identity, ids.has(p.identity)))
      if (me && !ids.has(me) && st.speaking[me]) { /* own speaking comes from the local meter */ }
    })
    // The client repairs short drops itself: show that. A room that ends without our asking is reconnected by us, a
    // few times; one the server ended on purpose (removed, room closed, another session took over) is an eviction.
    room.on(RoomEvent.Reconnecting, () => { if (this.room === room) this.dispatch({ type: 'wobble' }) })
    room.on(RoomEvent.Reconnected, () => { if (this.room === room) this.dispatch({ type: 'up' }) })
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (this.room !== room) return
      this.room = null
      if (!this.channelId) return
      if (reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.DUPLICATE_IDENTITY) { this.leave(true); return }
      void this.disconnectSfu()
      this.transportLost(reason === undefined ? 'disconnected' : DisconnectReason[reason] ?? String(reason))
    })
    try {
      if (keys) await room.setE2EEEnabled(true)
      await room.connect(grant.url, grant.token, { autoSubscribe: false })
      room.remoteParticipants.forEach((p) => this.crypto?.hello(p.identity))
      room.remoteParticipants.forEach((p) => { useStore.getState().setPeerStatus(p.identity, 'connected'); p.trackPublications.forEach((pub) => this.sfuAutoSubscribe(pub, p)) })
      await this.sfuPublishMic()
      if (this.camera) await this.sfuPublish('camera', this.camera.getVideoTracks()[0])
      if (this.screen) await this.sfuPublish('screen', this.screen.getVideoTracks()[0])
      if (this.room === room && this.channelId === channelId) this.dispatch({ type: 'up' })
    } catch (e) {
      if (this.room !== room) return // left, or replaced, while connecting
      await this.disconnectSfu()
      this.transportLost(`connect: ${(e as Error).message}`)
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
    if (track.source === Track.Source.ScreenShareAudio) { this.playStream(userId, stream); return }
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

  private sfuAutoSubscribe(pub: RemoteTrackPublication, participant: RemoteParticipant) {
    const stream = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio
    pub.setSubscribed(!stream || !!useStore.getState().watching[participant.identity])
  }

  private sfuScreenPub(userId: string): RemoteTrackPublication | undefined {
    return this.room?.remoteParticipants.get(userId)?.getTrackPublication(Track.Source.ScreenShare)
  }

  private async sfuPublish(kind: 'camera' | 'screen', track: MediaStreamTrack) {
    if (!this.room) return
    await this.sfuUnpublish(kind)
    const local = new LocalVideoTrack(track, undefined, false)
    try {
      await this.room.localParticipant.publishTrack(local, { source: kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera, simulcast: kind === 'camera', videoEncoding: { maxBitrate: kind === 'screen' ? this.screenBitrate : CAMERA_MAX_BITRATE, maxFramerate: kind === 'screen' ? this.screenFps : 30 } })
      if (kind === 'screen') this.sfuScreen = local; else this.sfuCamera = local
      const sound = kind === 'screen' ? this.screen?.getAudioTracks()[0] : undefined
      if (sound) {
        const a = new LocalAudioTrack(sound, undefined, false)
        await this.room.localParticipant.publishTrack(a, { source: Track.Source.ScreenShareAudio, audioPreset: { maxBitrate: 128_000 }, dtx: false, red: false, forceStereo: true })
        this.sfuScreenAudio = a
      }
    } catch (e) { useStore.getState().pushToast(t('Could not publish {kind}: {error}', { kind, error: (e as Error).message }), 'error') }
  }

  private async sfuUnpublish(kind: 'camera' | 'screen') {
    const t = kind === 'screen' ? this.sfuScreen : this.sfuCamera
    if (!t) return
    if (kind === 'screen') this.sfuScreen = null; else this.sfuCamera = null
    try { await this.room?.localParticipant.unpublishTrack(t, false) } catch { /* already gone */ }
    if (kind === 'screen' && this.sfuScreenAudio) { const a = this.sfuScreenAudio; this.sfuScreenAudio = null; try { await this.room?.localParticipant.unpublishTrack(a, false) } catch { /* already gone */ } }
  }

  private async startCrypto() {
    const s = useStore.getState()
    const me = s.user?.id
    if (!me) return
    const c = await CallCrypto.create(me, (to, data) => { sendOp({ op: 'voice_signal', to, data }) }, () => this.publishCrypto())
    this.crypto = c
    if (!this.sfu) { this.meshCrypto = new MeshCrypto(); c.attach(this.meshCrypto) }
    this.publishCrypto()
  }

  private endCrypto() {
    this.crypto?.close(); this.crypto = null
    this.meshCrypto?.close(); this.meshCrypto = null
    useStore.getState().setCallE2ee(null)
  }

  /** Safety code and who we hold keys for → store, for the call's lock badge. */
  private publishCrypto() {
    const c = this.crypto
    if (!c) return
    c.safetyCode().then((code) => { if (this.crypto === c) useStore.getState().setCallE2ee({ code, keyed: c.keyedPeers }) }).catch(() => {})
  }

  private async disconnectSfu() {
    const room = this.room
    this.room = null
    this.sfuCamera = null; this.sfuScreen = null; this.sfuMic = null; this.sfuScreenAudio = null
    this.streamAudio.forEach((a) => { a.srcObject = null; a.remove() }); this.streamAudio.clear()
    this.sfuAudio.forEach((a) => { a.srcObject = null; a.remove() }); this.sfuAudio.clear()
    this.sfuMeters.forEach((stop) => stop()); this.sfuMeters.clear()
    if (room) { try { await room.disconnect(false) } catch { /* ignore */ } }
  }

  /** Latest RMS (0..1) of each remote participant's audio, for the studio console's meters (not in the store: it
   *  changes ten times a second and only the console polls it). */
  readonly levels = new Map<string, number>()

  /** Input level 0..1 of a participant: remote peers from their meter, yourself from the mic before the talk gate. */
  level(userId: string): number {
    const s = useStore.getState()
    if (userId === s.user?.id) return s.selfMute || s.selfDeaf ? 0 : Math.max(0, Math.min(1, (s.inputLevel + 60) / 60))
    return Math.min(1, Math.sqrt(this.levels.get(userId) ?? 0) * 2)
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
        const rms = Math.sqrt(sum / buf.length)
        this.levels.set(userId, rms)
        const loud = rms > 0.02
        const s = useStore.getState()
        const now = Date.now()
        if (loud) { quietSince = 0; s.setSpeaking(userId, true) }
        else if (s.speaking[userId]) { quietSince ||= now; if (now - quietSince > 250) s.setSpeaking(userId, false) }
      }, 100)
      return () => { clearInterval(id); this.levels.delete(userId); try { src.disconnect() } catch { /* ignore */ } }
    } catch {
      return () => {}
    }
  }
}

/** The one-time note about direct calls and IP addresses has been shown on this device. */
const DIRECT_SEEN = `${STORAGE_PREFIX}directCallNote`
/** Labels of devices the member said never to offer again. */
const IGNORED_DEVICES = `${STORAGE_PREFIX}ignoredDevices`
function ignoredDevices(): string[] { try { const v = JSON.parse(localStorage.getItem(IGNORED_DEVICES) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } }

/** Why a microphone or camera could not be opened, from the browser's error name, in the member's words. */
export function deviceErrorText(kind: 'microphone' | 'camera', err: { name?: string } | null): string {
  const mic = kind === 'microphone'
  switch (err?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return mic ? t("Parley isn't allowed to use your microphone. Allow it for Parley in your browser's or system's settings, then try again.") : t("Parley isn't allowed to use your camera. Allow it for Parley in your browser's or system's settings, then try again.")
    case 'NotFoundError': case 'OverconstrainedError':
      return mic ? t('No microphone was found. Connect one, then try again.') : t('No camera was found. Connect one, then try again.')
    case 'NotReadableError': case 'AbortError':
      return mic ? t("Your microphone isn't responding. Another app may be using it.") : t("Your camera isn't responding. Another app may be using it.")
    default:
      return mic ? t("Parley couldn't use your microphone. Check that one is connected and allowed for Parley.") : t("Parley couldn't use your camera. Check that one is connected and allowed for Parley.")
  }
}

/** A failed call's reason in the member's words. `detail` is the engine's note; a microphone's starts with the error's name. */
export function callFailureText(reason: CallReason | null, detail?: string | null): string {
  switch (reason) {
    case 'socket': return t('Parley lost its connection to the server.')
    case 'refused': return t("The server didn't let you join this call.")
    case 'microphone': return deviceErrorText('microphone', { name: detail?.split(':')[0] })
    case 'unsupported': return t("This call is end-to-end encrypted, and this browser can't encrypt calls. Use a current version of Chrome, Edge, Firefox or Safari.")
    default: return t("The call's connection dropped and couldn't be restored.")
  }
}

export const voice = new VoiceManager()
declare global { interface Window { __parleyVoice?: () => { mode: string; room: string | null; remote: number; channel: string | null } } }
if (typeof window !== 'undefined') window.__parleyVoice = () => voice.debug
if (typeof window !== 'undefined') setInterval(() => voice.checkAfk(), 15_000)
/** Test hook: run the inactivity check as if `ms` more had passed. */
if (typeof window !== 'undefined') (window as unknown as { __parleyAfk: (ms: number) => boolean }).__parleyAfk = (ms) => voice.checkAfk(Date.now() + ms)
/** Debug/test hook: active audio profile, live stats and the Opus parameters each peer negotiated. */
if (typeof window !== 'undefined') (window as unknown as { __parleyAudio: () => Promise<unknown> }).__parleyAudio = () => voice.audioDebug()

// Priority speaker ducking: re-apply volumes whenever who-is-the-talking-priority-speaker changes.
let prevPriority: string | null = null
useStore.subscribe(() => { const now = voice.priorityTalking(); if (now !== prevPriority) { prevPriority = now; voice.reapplyVolumes() } })
/** Test hooks: who is ducking everyone, and pretend someone is talking (no real speech in headless tests). */
if (typeof window !== 'undefined') (window as unknown as { __parleyDuck: () => unknown }).__parleyDuck = () => ({ talking: voice.priorityTalking(), priority: Object.values(useStore.getState().voiceStates).filter((v) => v.priority).map((v) => v.user_id) })
if (typeof window !== 'undefined') (window as unknown as { __parleySpeaking: (id: string, on: boolean) => void }).__parleySpeaking = (id, on) => useStore.getState().setSpeaking(id, on)

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
if (typeof window !== 'undefined') (window as unknown as { __parleyMic: { info: () => unknown; end: () => void; unplug: () => void } }).__parleyMic = { info: () => voice.micDebug, end: () => voice.endMicForTest(), unplug: () => voice.unplugMicForTest() }
/** Test hook: the call's connection state, its log, and dropping the transport as a network failure would. */
if (typeof window !== 'undefined') (window as unknown as { __parleyCall: { events: () => string[]; drop: (detail?: string) => void } }).__parleyCall = { events: () => voice.events, drop: (d) => voice.dropForTest(d) }
