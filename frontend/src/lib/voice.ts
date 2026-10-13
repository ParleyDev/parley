import { useStore } from '../store'
import type { VoiceState } from './types'
import { sendOp, type SignalData } from './ws'

/**
 * Mesh WebRTC voice: every participant holds one RTCPeerConnection per other participant.
 * Signaling rides the app WebSocket. Rule to avoid glare: the *joiner* sends offers to everyone
 * already in the channel; existing members only answer.
 */
interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  pendingCandidates: RTCIceCandidateInit[]
  stopMeter?: () => void
}

class VoiceManager {
  private local: MediaStream | null = null
  private peers = new Map<string, Peer>()
  private channelId: string | null = null
  private audioCtx: AudioContext | null = null
  private stopLocalMeter?: () => void
  private joining = false

  get currentChannel() { return this.channelId }

  async join(channelId: string) {
    if (this.joining) return
    const s = useStore.getState()
    if (this.channelId === channelId) return
    this.joining = true
    try {
      if (!this.local) {
        if (!navigator.mediaDevices?.getUserMedia) {
          s.pushToast(window.isSecureContext
            ? 'This browser does not support microphone capture'
            : `Microphone needs a secure context. Open the app over HTTPS (e.g. https://${location.hostname}:3443) or via localhost.`, 'error')
          return
        }
        try {
          this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        } catch (e) {
          s.pushToast(`Microphone unavailable: ${(e as Error).message}`, 'error')
          return
        }
        this.applyMute(s.selfMute || s.selfDeaf)
        this.stopLocalMeter = this.meter(this.local, s.user!.id)
      }
      // Moving channels: tear down old peers; the server re-announces us.
      if (this.channelId) this.closeAllPeers()
      this.channelId = channelId
      s.setMyVoice(channelId, true)
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
    this.local?.getTracks().forEach((t) => t.stop()); this.local = null
    this.audioCtx?.close().catch(() => {}); this.audioCtx = null
    s.setMyVoice(null)
  }

  setMute(mute: boolean) {
    const s = useStore.getState()
    const deaf = mute ? s.selfDeaf : false // unmuting also undeafens, like Discord
    s.setSelfVoiceFlags(mute, deaf)
    this.applyMute(mute)
    this.applyDeaf(deaf)
    if (this.channelId) sendOp({ op: 'voice_state', self_mute: mute, self_deaf: deaf })
  }

  private muteBeforeDeaf = false

  setDeaf(deaf: boolean) {
    const s = useStore.getState()
    // Deafening also mutes; undeafening restores the prior mute choice.
    if (deaf) this.muteBeforeDeaf = s.selfMute
    const mute = deaf ? true : this.muteBeforeDeaf
    s.setSelfVoiceFlags(mute, deaf)
    this.applyMute(mute)
    this.applyDeaf(deaf)
    if (this.channelId) sendOp({ op: 'voice_state', self_mute: mute, self_deaf: deaf })
  }

  // ---- events from the socket ----

  /** Our own or another user's voice state changed. */
  onVoiceState(v: VoiceState) {
    const me = useStore.getState().user?.id
    if (!me || !this.channelId) return
    if (v.user_id === me) {
      if (v.channel_id === this.channelId) {
        // Server acknowledged our join: offer to everyone already here.
        useStore.getState().setMyVoice(this.channelId, false)
        const others = Object.values(useStore.getState().voiceStates).filter((o) => o.channel_id === this.channelId && o.user_id !== me)
        others.forEach((o) => { if (!this.peers.has(o.user_id)) this.offerTo(o.user_id) })
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
    const peer = this.peers.get(from) ?? this.createPeer(from)
    try {
      if (data.type === 'offer') {
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
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

  private async offerTo(userId: string) {
    const peer = this.createPeer(userId)
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      sendOp({ op: 'voice_signal', to: userId, data: { type: 'offer', sdp: offer.sdp } })
    } catch (e) {
      console.warn('offer failed', e)
      useStore.getState().setPeerStatus(userId, 'failed')
    }
  }

  private createPeer(userId: string): Peer {
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

    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!))
    pc.onicecandidate = (e) => sendOp({ op: 'voice_signal', to: userId, data: { type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null } })
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      audio.srcObject = stream
      audio.play().catch(() => {})
      peer.stopMeter?.()
      peer.stopMeter = this.meter(stream, userId)
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') useStore.getState().setPeerStatus(userId, 'connected')
      else if (st === 'failed') { useStore.getState().setPeerStatus(userId, 'failed'); pc.restartIce() }
      else if (st === 'disconnected') useStore.getState().setPeerStatus(userId, 'connecting')
    }
    return peer
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

  private applyMute(muted: boolean) { this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted)) }
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
