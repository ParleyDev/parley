import { api, getToken } from './api'
import { clickAt } from './multitrack'
import { engine, useDaw } from './daw'
import { serverNow, syncClock, toLocal } from './clock'
import { useStore } from '../store'
import type { StudioConfig, StudioSession } from './types'
import { voice } from './voice'
import { t } from '../lib/i18n'

/** Console defaults for a studio that has never been configured (the server's defaults). */
export const DEFAULT_STUDIO: StudioConfig = { bpm: 120, beats: 4, click: false, count_in: 0, disarmed: [] }


/**
 * Recording Studio client: while a take runs, every band member records their armed tracks, each from the input it is
 * set to (their default microphone, or an input device by name and one or both of its channels: a two-input
 * interface makes two separate takes), with MediaRecorder, streaming 5-second chunks to a take of its own on the
 * server. A member with no track of their own yet records their microphone as one take, which makes them one. The
 * offset between the take's downbeat and the moment recording really began is stored with each take so it lines up
 * (negative during a count-in: pre-roll). It follows the studio's state rather than single events, so arming a track
 * during a take, or joining the band late, punches in a new clip, and disarming punches out.
 */
type Rec = { rec: MediaRecorder; trackId: string; sessionId: string; startedAt: number; queue: Promise<void>; release: () => void }

class StudioRecorder {
  /** What is recording, by track ('' for a member's take with no track of their own yet). */
  private recs = new Map<string, Rec>()
  private starting = new Set<string>()
  /** Tracks we could not record in a take (no mic, refused, no such input): not retried on every store change. */
  private failed = new Set<string>()
  /** The take announced by STUDIO_SESSION, live until its stop, even before the sessions list has caught up. */
  private known: { channel: string; session: string } | null = null
  /** Shared inputs while recording: the default microphone, and input devices by name. */
  private inputs = new Map<string, { stream: Promise<MediaStream | null>; users: number }>()

  get recording() { return this.recs.size > 0 }

  constructor() {
    if (typeof window === 'undefined') return
    let prev = useStore.getState()
    useStore.subscribe((s) => {
      if (s.studio === prev.studio && s.voiceStates === prev.voiceStates && s.channels === prev.channels && s.myVoiceChannelId === prev.myVoiceChannelId) return
      prev = s
      this.sync()
    })
    // Arming, disarming or re-pointing a track during a take punches in or out.
    useDaw.subscribe((s, p) => { if (s.lanes !== p.lanes || s.project?.id !== p.project?.id) this.sync() })
  }

  onSession(d: { channel_id: string; action: 'start' | 'stop'; session_id: string; started_at?: string; bpm?: number; beats?: number; click?: boolean; count_in_ms?: number; solo?: boolean; started_by?: string; project_id?: string | null }) {
    if (d.action === 'stop') { if (this.known?.session === d.session_id) this.known = null; void this.stopAll(d.session_id); metronome.stop(d.session_id); return }
    this.known = { channel: d.channel_id, session: d.session_id }
    // The sessions list is still loading: act on the event itself.
    const start = d.started_at ? Date.parse(d.started_at) : Date.now()
    // A take recorded alone is only its starter's.
    if (d.solo && d.started_by !== useStore.getState().user?.id) return
    // Over a project the project's grid clicks along with the backing (lib/daw); this plays the count-in.
    if (useStore.getState().myVoiceChannelId === d.channel_id && this.inBand(d.channel_id)) metronome.run(d.session_id, toLocal(start), d.bpm ?? 120, d.beats ?? 4, !!d.click && !d.project_id, d.count_in_ms ?? 0)
    for (const key of this.wanted(d.channel_id)) void this.start(key, d.session_id, start)
  }

  private inBand(channelId: string) {
    const s = useStore.getState()
    const mine = s.user ? s.voiceStates[s.user.id] : undefined
    return !!mine && mine.channel_id === channelId && !mine.suppress
  }

  /** What I record in this project's voice room now: my armed tracks, or one take of mine if I have no track yet. */
  private wanted(channelId: string): string[] {
    const s = useStore.getState()
    const me = s.user?.id
    const ch = s.channels[channelId]
    if (!me || s.myVoiceChannelId !== channelId || !this.inBand(channelId) || ch?.kind !== 'project') return []
    const { project, lanes } = useDaw.getState()
    const mine = project && project.id === ch.studio?.project_id ? Object.values(lanes).filter((l) => l.kind === 'audio' && l.user_id === me) : []
    if (mine.length) return mine.filter((l) => l.armed).map((l) => l.id)
    return (ch.studio?.disarmed ?? []).includes(me) ? [] : ['']
  }

  /** Bring recording and the click in line with the studio: the take running, my role, my armed tracks. */
  private sync() {
    const s = useStore.getState()
    const ch = s.myVoiceChannelId
    const list = ch ? s.studio[ch] : undefined
    const found: StudioSession | undefined = list?.find((x) => !x.ended_at)
    const live = found && (!found.solo || found.started_by === s.user?.id) ? found : undefined
    if (this.known && (this.known.channel !== ch || list?.some((x) => x.id === this.known!.session && x.ended_at))) this.known = null
    const liveId = live?.id ?? this.known?.session ?? null
    if (live && ch && this.inBand(ch)) metronome.run(live.id, toLocal(Date.parse(live.started_at)), live.bpm, live.beats, live.click && !live.project_id, live.count_in_ms)
    else if (!liveId || !ch || !this.inBand(ch)) metronome.stop()
    const want = new Set(liveId && ch ? this.wanted(ch) : [])
    for (const [key, r] of this.recs) if (!want.has(key) || r.sessionId !== liveId) void this.stop(key)
    if (live) for (const key of want) if (!this.recs.has(key) && !this.failed.has(`${live.id}:${key}`)) void this.start(key, live.id, Date.parse(live.started_at))
  }

  /** The audio for a track: its input device (shared while recording) and channel, or the microphone as the call has it. */
  private async source(key: string): Promise<{ stream: MediaStream; release: () => void } | null> {
    const input = key ? useDaw.getState().lanes[key]?.input : null
    const device = input?.device ?? '', channel = input?.channel ?? 'mono'
    // Tracks on the same input share one capture of it (opened once, even when they start together).
    const take = (id: string, open: () => Promise<MediaStream | null>) => {
      const have = this.inputs.get(id)
      if (have) { have.users++; return have.stream }
      const stream = open().catch((e) => { this.inputs.delete(id); throw e })
      this.inputs.set(id, { stream, users: 1 })
      return stream
    }
    const drop = (id: string, stop: (st: MediaStream) => void) => { const h = this.inputs.get(id); if (h && --h.users <= 0) { this.inputs.delete(id); void h.stream.then((st) => { if (st) stop(st) }) } }
    if (!device && channel === 'mono') {
      const stream = await take('', async () => voice.getRecordingStream())
      if (!stream || !stream.getAudioTracks().length) return null
      return { stream, release: () => drop('', () => voice.releaseRecordingStream()) }
    }
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    const id = devices.find((d) => d.kind === 'audioinput' && d.label === device)?.deviceId
    if (device && !id) throw new Error(t('The input "{name}" is not on this device', { name: device }))
    const raw = await take(`dev:${device}`, () => navigator.mediaDevices.getUserMedia({ audio: { ...(id ? { deviceId: { exact: id } } : {}), channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }))
    if (!raw) return null
    // One channel of it, both as stereo, or both mixed to mono.
    // The engine's context: already running (a context made here may be left suspended outside a click).
    const ctx = engine.audio()
    ctx.resume().catch(() => {})
    const src = ctx.createMediaStreamSource(raw), dest = ctx.createMediaStreamDestination()
    if (channel === '1' || channel === '2') { const split = ctx.createChannelSplitter(2); src.connect(split); split.connect(dest, channel === '1' ? 0 : 1); dest.channelCount = 1 }
    else if (channel === '1/2') { dest.channelCount = 2; src.connect(dest) }
    else { dest.channelCount = 1; dest.channelCountMode = 'explicit'; src.connect(dest) }
    return { stream: dest.stream, release: () => { src.disconnect(); drop(`dev:${device}`, (st) => st.getTracks().forEach((tr) => tr.stop())) } }
  }

  private async start(key: string, sessionId: string, serverStart: number) {
    if (this.recs.has(key) || this.starting.has(key)) return
    this.starting.add(key)
    let release: (() => void) | null = null
    try {
      const src = await this.source(key)
      if (!src) { this.failed.add(`${sessionId}:${key}`); useStore.getState().pushToast(t('Recording started, but your microphone is not available'), 'error'); return }
      release = src.release
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
      await syncClock()
      const offset = Math.round(serverNow() - serverStart)
      // Recording over the project: placed earlier by the time from hearing it to the mic capturing what is played.
      const track = await api.post<{ id: string }>(`/studio/sessions/${sessionId}/tracks`, { offset_ms: offset, content_type: mime.split(';')[0] || 'audio/webm', latency_ms: engine.latencyMs(src.stream), ...(key ? { lane_id: key } : {}) })
      const rec = new MediaRecorder(src.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined)
      const r: Rec = { rec, trackId: track.id, sessionId, startedAt: Date.now(), queue: Promise.resolve(), release: src.release }
      release = null
      rec.ondataavailable = (e) => { if (e.data.size) this.enqueue(r, e.data) }
      rec.onstop = () => { r.queue = r.queue.then(() => this.finish(key, r)) }
      rec.start(5000)
      this.recs.set(key, r)
      this.expose()
      if (this.recs.size === 1) useStore.getState().pushToast(t('Recording: your track is being captured'))
    } catch (e) {
      this.failed.add(`${sessionId}:${key}`)
      release?.()
      useStore.getState().pushToast((e as Error).message, 'error')
    } finally {
      this.starting.delete(key)
      // Things may have moved on while we were starting (disarmed, take stopped).
      queueMicrotask(() => this.sync())
    }
  }

  private enqueue(r: Rec, blob: Blob) {
    r.queue = r.queue.then(async () => {
      const token = getToken()
      const res = await fetch(`/api/studio/sessions/${r.sessionId}/tracks/${r.trackId}/chunks`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: blob })
      if (!res.ok) throw new Error(`chunk upload failed (${res.status})`)
    }).catch((e) => { useStore.getState().pushToast(t('Recording upload: {message}', { message: (e as Error).message }), 'error') })
  }

  private async finish(key: string, r: Rec) {
    if (this.recs.get(key) === r) this.recs.delete(key)
    r.release()
    this.expose()
    try { await api.post(`/studio/sessions/${r.sessionId}/tracks/${r.trackId}/finish`, { duration_ms: Date.now() - r.startedAt }) } catch { /* server keeps what it has */ }
  }

  private async stop(key: string) {
    const r = this.recs.get(key)
    if (!r) return
    this.recs.delete(key)
    if (r.rec.state !== 'inactive') r.rec.stop()   // onstop → finish after the last chunk is queued
    else await this.finish(key, r)
    this.expose()
  }

  async stopAll(sessionId?: string) { for (const [key, r] of Array.from(this.recs)) if (!sessionId || r.sessionId === sessionId) await this.stop(key) }

  private expose() { (window as unknown as { __parleyStudio?: unknown }).__parleyStudio = { recording: this.recs.size > 0, tracks: [...this.recs.keys()], trackId: [...this.recs.values()][0]?.trackId ?? null } }
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
export async function startTake(channelId: string, name = '', positionMs = 0, solo = false) {
  return api.post(`/channels/${channelId}/studio/sessions`, { name, position_ms: Math.round(positionMs), solo })
}
