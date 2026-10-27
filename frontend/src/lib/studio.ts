import { api, getToken } from './api'
import { useStore } from '../store'
import { voice } from './voice'
import { t } from '../lib/i18n'

/**
 * Recording Studio client: when the engineer starts a session, every band member (unsuppressed participant of that
 * studio channel) records its own mic with MediaRecorder and streams 5-second chunks to its track on the server. The
 * offset between the server's start time and the moment recording really began is stored with the track so the
 * mixer can line everything up.
 */
class StudioRecorder {
  private rec: MediaRecorder | null = null
  private sessionId: string | null = null
  private trackId: string | null = null
  private startedAt = 0
  private queue: Promise<void> = Promise.resolve()
  private stream: MediaStream | null = null

  get recording() { return !!this.rec }

  onSession(d: { channel_id: string; action: 'start' | 'stop'; session_id: string; started_at?: string }) {
    const s = useStore.getState()
    if (d.action === 'stop') { if (this.sessionId === d.session_id) void this.stop(); return }
    if (s.myVoiceChannelId !== d.channel_id) return
    const mine = s.user ? s.voiceStates[s.user.id] : undefined
    if (!mine || mine.suppress) return   // audience is not recorded
    void this.start(d.session_id, d.started_at ? new Date(d.started_at).getTime() : Date.now())
  }

  private async start(sessionId: string, serverStart: number) {
    if (this.rec) return
    const stream = voice.getRecordingStream()
    if (!stream || !stream.getAudioTracks().length) { useStore.getState().pushToast(t('Recording started, but your microphone is not available'), 'error'); return }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
    const offset = Math.max(0, Date.now() - serverStart)
    try {
      const track = await api.post<{ id: string }>(`/studio/sessions/${sessionId}/tracks`, { offset_ms: offset, content_type: mime.split(';')[0] || 'audio/webm' })
      this.sessionId = sessionId; this.trackId = track.id; this.stream = stream
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined)
      rec.ondataavailable = (e) => { if (e.data.size) this.enqueue(e.data) }
      rec.onstop = () => { this.queue = this.queue.then(() => this.finish()) }
      rec.start(5000)
      this.rec = rec; this.startedAt = Date.now()
      this.expose()
      useStore.getState().pushToast(t('Recording: your track is being captured'))
    } catch (e) { useStore.getState().pushToast((e as Error).message, 'error') }
  }

  private enqueue(blob: Blob) {
    const sid = this.sessionId, tid = this.trackId
    if (!sid || !tid) return
    this.queue = this.queue.then(async () => {
      const token = getToken()
      const r = await fetch(`/api/studio/sessions/${sid}/tracks/${tid}/chunks`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: blob })
      if (!r.ok) throw new Error(`chunk upload failed (${r.status})`)
    }).catch((e) => { useStore.getState().pushToast(t('Recording upload: {message}', { message: (e as Error).message }), 'error') })
  }

  private async finish() {
    const sid = this.sessionId, tid = this.trackId, dur = Date.now() - this.startedAt
    this.sessionId = null; this.trackId = null; this.rec = null
    this.stream?.getTracks().forEach((tr) => tr.stop()); this.stream = null
    voice.releaseRecordingStream()
    this.expose()
    if (sid && tid) { try { await api.post(`/studio/sessions/${sid}/tracks/${tid}/finish`, { duration_ms: dur }) } catch { /* server keeps what it has */ } }
  }

  async stop() {
    const rec = this.rec
    if (!rec) return
    if (rec.state !== 'inactive') rec.stop()   // onstop → finish after the last chunk is queued
    else await this.finish()
  }

  private expose() { (window as unknown as { __parleyStudio?: unknown }).__parleyStudio = { recording: !!this.rec, trackId: this.trackId, sessionId: this.sessionId } }
}

export const studio = new StudioRecorder()
