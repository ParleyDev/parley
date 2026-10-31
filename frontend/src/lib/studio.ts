import { api, getToken } from './api'
import { clickAt } from './multitrack'
import { useStore } from '../store'
import type { StudioConfig, StudioSession } from './types'
import { voice } from './voice'
import { t } from '../lib/i18n'

/** Console defaults for a studio that has never been configured (the server's defaults). */
export const DEFAULT_STUDIO: StudioConfig = { bpm: 120, beats: 4, click: false, count_in: 0, disarmed: [] }

/** Am I a band member of this studio, armed by the console? (Engineers are in the band too; the audience is not.) */
function armedHere(channelId: string): boolean {
  const s = useStore.getState()
  const me = s.user?.id
  const mine = me ? s.voiceStates[me] : undefined
  const ch = s.channels[channelId]
  return !!me && s.myVoiceChannelId === channelId && !!mine && !mine.suppress && ch?.kind === 'studio' && !(ch.studio?.disarmed ?? []).includes(me)
}

/**
 * Recording Studio client: while the engineer runs a take, every armed band member records its own mic with
 * MediaRecorder and streams 5-second chunks to its track on the server. The offset between the take's downbeat and
 * the moment recording really began is stored with the track so the mixer can line everything up (negative during a
 * count-in: pre-roll). It follows the studio's state rather than single events, so arming during a take, or joining
 * the band late, punches in a new clip, and disarming punches out.
 */
class StudioRecorder {
  private rec: MediaRecorder | null = null
  private sessionId: string | null = null
  private trackId: string | null = null
  private startedAt = 0
  private queue: Promise<void> = Promise.resolve()
  private stream: MediaStream | null = null
  private starting = false
  /** A take we could not record (no mic, refused): not retried on every store change. */
  private failed: string | null = null
  /** The take announced by STUDIO_SESSION, live until its stop, even before the sessions list has caught up. */
  private known: { channel: string; session: string } | null = null

  get recording() { return !!this.rec }

  constructor() {
    if (typeof window === 'undefined') return
    let prev = useStore.getState()
    useStore.subscribe((s) => {
      if (s.studio === prev.studio && s.voiceStates === prev.voiceStates && s.channels === prev.channels && s.myVoiceChannelId === prev.myVoiceChannelId) return
      prev = s
      this.sync()
    })
  }

  onSession(d: { channel_id: string; action: 'start' | 'stop'; session_id: string; started_at?: string; bpm?: number; beats?: number; click?: boolean; count_in_ms?: number }) {
    if (d.action === 'stop') { if (this.known?.session === d.session_id) this.known = null; if (this.sessionId === d.session_id) void this.stop(); metronome.stop(d.session_id); return }
    this.known = { channel: d.channel_id, session: d.session_id }
    // The sessions list is still loading: act on the event itself.
    const start = d.started_at ? Date.parse(d.started_at) : Date.now()
    if (useStore.getState().myVoiceChannelId === d.channel_id && this.inBand(d.channel_id)) metronome.run(d.session_id, start, d.bpm ?? 120, d.beats ?? 4, !!d.click, d.count_in_ms ?? 0)
    if (armedHere(d.channel_id)) void this.start(d.session_id, start)
  }

  private inBand(channelId: string) {
    const s = useStore.getState()
    const mine = s.user ? s.voiceStates[s.user.id] : undefined
    return !!mine && mine.channel_id === channelId && !mine.suppress
  }

  /** Bring recording and the click in line with the studio: the take running, my role, my arm. */
  private sync() {
    const s = useStore.getState()
    const ch = s.myVoiceChannelId
    const list = ch ? s.studio[ch] : undefined
    const live: StudioSession | undefined = list?.find((x) => !x.ended_at)
    if (this.known && (this.known.channel !== ch || list?.some((x) => x.id === this.known!.session && x.ended_at))) this.known = null
    const liveId = live?.id ?? this.known?.session ?? null
    if (live && ch && this.inBand(ch)) metronome.run(live.id, Date.parse(live.started_at), live.bpm, live.beats, live.click, live.count_in_ms)
    else if (!liveId || !ch || !this.inBand(ch)) metronome.stop()
    if (this.rec && (!liveId || liveId !== this.sessionId || !armedHere(ch!))) { void this.stop(); return }
    if (live && ch && !this.rec && !this.starting && this.failed !== live.id && armedHere(ch)) void this.start(live.id, Date.parse(live.started_at))
  }

  private async start(sessionId: string, serverStart: number) {
    if (this.rec || this.starting) return
    this.starting = true
    try {
      await this.queue   // a clip that is still finishing (punch out, then straight back in)
      const stream = voice.getRecordingStream()
      if (!stream || !stream.getAudioTracks().length) { this.failed = sessionId; useStore.getState().pushToast(t('Recording started, but your microphone is not available'), 'error'); return }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
      const offset = Date.now() - serverStart
      const track = await api.post<{ id: string }>(`/studio/sessions/${sessionId}/tracks`, { offset_ms: offset, content_type: mime.split(';')[0] || 'audio/webm' })
      this.sessionId = sessionId; this.trackId = track.id; this.stream = stream
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined)
      rec.ondataavailable = (e) => { if (e.data.size) this.enqueue(e.data) }
      rec.onstop = () => { this.queue = this.queue.then(() => this.finish()) }
      rec.start(5000)
      this.rec = rec; this.startedAt = Date.now()
      this.expose()
      useStore.getState().pushToast(t('Recording: your track is being captured'))
    } catch (e) {
      this.failed = sessionId
      voice.releaseRecordingStream()
      useStore.getState().pushToast((e as Error).message, 'error')
    } finally {
      this.starting = false
      // Things may have moved on while we were starting (disarmed, take stopped).
      queueMicrotask(() => this.sync())
    }
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

/**
 * The band's click: every band member's client plays it locally, in time with the take's downbeat (server time), so
 * it never reaches the recordings (they tap the mic) and needs no network sync. With a count-in it starts that many
 * bars early; with the metronome off it plays only the count-in.
 */
class Metronome {
  private ctx: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private key = ''
  private session: string | null = null
  private ticks = 0

  run(sessionId: string, downbeat: number, bpm: number, beats: number, click: boolean, countInMs: number) {
    if (!click && !countInMs) { this.stop(); return }
    const key = `${sessionId}:${downbeat}:${bpm}:${beats}:${click}:${countInMs}`
    if (key === this.key) return
    this.stop()
    this.key = key; this.session = sessionId
    const ctx = (this.ctx ??= new AudioContext())
    ctx.resume().catch(() => {})
    const beatMs = 60_000 / bpm
    const countBeats = Math.round(countInMs / beatMs)
    // First beat still ahead of us (the count-in may already be under way when we hear of the take).
    let n = Math.max(-countBeats, Math.ceil((Date.now() - downbeat) / beatMs))
    const tick = () => {
      const now = Date.now()
      while (downbeat + n * beatMs < now + 120) {
        if (!click && n >= 0) { this.stop(); return }
        const at = downbeat + n * beatMs
        if (at >= now - 10) { clickAt(ctx, ctx.destination, ctx.currentTime + Math.max(0, at - now) / 1000, ((n % beats) + beats) % beats === 0, n < 0); this.ticks++ }
        n++
      }
      this.expose()
    }
    tick()
    this.timer = setInterval(tick, 25)
  }

  /** Stop the click (of that take only, when given). */
  stop(sessionId?: string) {
    if (sessionId && sessionId !== this.session) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null; this.key = ''; this.session = null
    this.expose()
  }

  private expose() { (window as unknown as { __parleyClick?: unknown }).__parleyClick = { running: !!this.timer, ticks: this.ticks } }
}

const metronome = new Metronome()
export const studio = new StudioRecorder()

/** Arm or disarm a band member (shared by every engineer; during a take it punches them in or out). */
export const setArm = (channelId: string, userId: string, armed: boolean) => api.put(`/channels/${channelId}/studio/arm/${userId}`, { armed })

/** Change the studio's tempo, beats per bar, metronome or count-in bars. */
export const setStudioConfig = (channelId: string, patch: Partial<Omit<StudioConfig, 'disarmed'>>) => api.patch(`/channels/${channelId}/studio/config`, patch)

/** Start a take with the armed band members (the engineer's console and the Record button share this). */
export async function startTake(channelId: string, name = '') {
  return api.post(`/channels/${channelId}/studio/sessions`, { name })
}
