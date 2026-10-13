import { useStore } from '../store'
import type { VoiceState } from './types'
import { sendOp, type SignalData } from './ws'

/**
 * Mesh WebRTC voice/video: every participant holds one RTCPeerConnection per other participant.
 * Signaling rides the app WebSocket. Rule to avoid glare: the *joiner* sends offers to everyone
 * already in the channel; existing members only answer.
 *
 * Each connection carries three fixed transceivers negotiated once: [audio, camera, screen].
 * Turning camera/screen on or off swaps the sender track with replaceTrack(), so no renegotiation
 * is ever needed. Remote on/off state comes from VOICE_STATE_UPDATE flags.
 */
interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  pendingCandidates: RTCIceCandidateInit[]
  stopMeter?: () => void
}

const CAMERA_CONSTRAINTS: MediaStreamConstraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false }
const CAMERA_MAX_BITRATE = 1_500_000
const SCREEN_MAX_BITRATE = 3_000_000

class VoiceManager {
  private mic: MediaStream | null = null
  private camera: MediaStream | null = null
  private screen: MediaStream | null = null
  private peers = new Map<string, Peer>()
  private channelId: string | null = null
  private audioCtx: AudioContext | null = null
  private stopLocalMeter?: () => void
  private joining = false
  private muteBeforeDeaf = false

  get currentChannel() { return this.channelId }

  // ---- public controls ----

  async join(channelId: string) {
    if (this.joining) return
    const s = useStore.getState()
    if (this.channelId === channelId) return
    this.joining = true
    try {
      if (!this.mic) {
        if (!navigator.mediaDevices?.getUserMedia) {
          s.pushToast(window.isSecureContext
            ? 'This browser does not support microphone capture'
            : `Microphone needs a secure context. Open the app over HTTPS (e.g. https://${location.hostname}:3443) or via localhost.`, 'error')
          return
        }
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        } catch (e) {
          s.pushToast(`Microphone unavailable: ${(e as Error).message}`, 'error')
          return
        }
        this.applyMute(s.selfMute || s.selfDeaf)
        this.stopLocalMeter = this.meter(this.mic, s.user!.id)
      }
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

  leave() {
    const s = useStore.getState()
    if (this.channelId) sendOp({ op: 'voice_leave' })
    this.channelId = null
    this.closeAllPeers()
    this.stopLocalMeter?.(); this.stopLocalMeter = undefined
    this.stopTracks(this.mic); this.mic = null
    this.stopTracks(this.camera); this.camera = null
    this.stopTracks(this.screen); this.screen = null
    this.audioCtx?.close().catch(() => {}); this.audioCtx = null
    s.setMyVoice(null)
  }

  setMute(mute: boolean) {
    const s = useStore.getState()
    const deaf = mute ? s.selfDeaf : false // unmuting also undeafens, like Discord
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
      s.setLocalMedia({ camera: null })
      this.pushState()
      return
    }
    try {
      this.camera = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    } catch (e) {
      s.pushToast(`Camera unavailable: ${(e as Error).message}`, 'error')
      return
    }
    const track = this.camera.getVideoTracks()[0]
    track.onended = () => { if (this.camera) this.toggleCamera() }
    this.peers.forEach((p) => this.replaceVideo(p.pc, 0, track))
    s.setLocalMedia({ camera: this.camera })
    this.pushState()
  }

  async toggleScreen() {
    const s = useStore.getState()
    if (this.screen) {
      this.stopTracks(this.screen); this.screen = null
      this.peers.forEach((p) => this.replaceVideo(p.pc, 1, null))
      s.setLocalMedia({ screen: null })
      this.pushState()
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) { s.pushToast('Screen sharing is not supported in this browser', 'error'); return }
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false })
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') s.pushToast(`Screen share failed: ${(e as Error).message}`, 'error')
      return
    }
    const track = this.screen.getVideoTracks()[0]
    // Browser "Stop sharing" button ends the track.
    track.onended = () => { if (this.screen) this.toggleScreen() }
    this.peers.forEach((p) => this.replaceVideo(p.pc, 1, track))
    s.setLocalMedia({ screen: this.screen })
    this.pushState()
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
          // Server acknowledged our join: offer to everyone already here, then re-announce media flags.
          s.setMyVoice(this.channelId, false)
          const others = Object.values(s.voiceStates).filter((o) => o.channel_id === this.channelId && o.user_id !== me)
          others.forEach((o) => { if (!this.peers.has(o.user_id)) this.offerTo(o.user_id) })
          if (this.camera || this.screen || s.selfMute || s.selfDeaf) this.pushState()
        }
      } else if (v.channel_id === null) {
        // Server evicted us (kicked, channel deleted, another tab took over).
        this.leave()
      }
      return
    }
    if (v.channel_id !== this.channelId && this.peers.has(v.user_id)) this.closePeer(v.user_id)
  }

  async onSignal(from: string, channelId: string, data: SignalData) {
    if (channelId !== this.channelId) return
    const peer = this.peers.get(from) ?? this.createPeer(from, false)
    try {
      if (data.type === 'offer') {
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        this.attachLocalTracks(peer.pc)
        await this.flushCandidates(peer)
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        sendOp({ op: 'voice_signal', to: from, data: { type: 'answer', sdp: answer.sdp } })
      } else if (data.type === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushCandidates(peer)
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

  // ---- internals ----

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
      sendOp({ op: 'voice_signal', to: userId, data: { type: 'offer', sdp: offer.sdp } })
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
    const peer: Peer = { pc, audio, pendingCandidates: [] }
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
        audio.srcObject = stream
        audio.play().catch(() => {})
        peer.stopMeter?.()
        peer.stopMeter = this.meter(stream, userId)
        return
      }
      const idx = this.videoTransceivers(pc).indexOf(e.transceiver)
      useStore.getState().setRemoteMedia(userId, idx === 1 ? 'screen' : 'camera', stream)
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') useStore.getState().setPeerStatus(userId, 'connected')
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
  private applyDeaf(deaf: boolean) { this.peers.forEach((p) => (p.audio.muted = deaf)) }

  /** Simple RMS voice-activity meter → store.speaking. Returns a stop function. */
  private meter(stream: MediaStream, userId: string): () => void {
    try {
      this.audioCtx ??= new AudioContext()
      const ctx = this.audioCtx
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
        const s = useStore.getState()
        const muted = userId === s.user?.id && (s.selfMute || s.selfDeaf)
        const loud = !muted && rms > 0.04
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
