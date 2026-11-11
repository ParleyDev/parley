import { create } from 'zustand'
import { api, getToken } from './api'
import { clickAt, encodeWav, peaksOf } from './multitrack'
import { useStore } from '../store'
import { t } from './i18n'
import type { StudioClip, StudioLane, StudioProject, StudioProjectFull, StudioSession, StudioTrack } from './types'

/**
 * The studio's DAW on the client: the open project (lanes, clips, the audio they use), edits, and the audio engine.
 *
 * Edits are ops, applied here at once and sent to the server, which applies them for everyone and broadcasts them
 * (STUDIO_PROJECT): everyone editing sees the same project live. Each edit of your own keeps its inverse, so undo and
 * redo send ops too. Ops from others arrive with the entities they left and the project's version; a gap in versions
 * reloads the project.
 *
 * The engine decodes every clip's audio once, plays the project from any position through a bus per lane (gain, pan,
 * mute / solo, meter) into the master, and renders it offline for export. While a take records into the project,
 * everyone in the studio hears the project from where the take started, in time with the take's downbeat: that is
 * the backing the band plays over (see `follow`).
 */

export type Op =
  | { op: 'project'; name?: string; bpm?: number; beats?: number; master_gain?: number }
  | { op: 'lane.put'; lane: Partial<StudioLane> & { id: string } }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: Partial<StudioClip> & { id: string } }
  | { op: 'clip.del'; id: string }
/** What the server broadcasts: puts carry the whole entity. */
type Applied =
  | { op: 'project'; project: Pick<StudioProject, 'name' | 'bpm' | 'beats' | 'master_gain'> }
  | { op: 'lane.put'; lane: StudioLane }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: StudioClip }
  | { op: 'clip.del'; id: string }

export interface DawState {
  project: StudioProject | null
  lanes: Record<string, StudioLane>
  clips: Record<string, StudioClip>
  audio: Record<string, StudioTrack>
  loading: boolean
  error: string | null
  /** Edits of mine: inverse ops to undo, ops to redo. */
  undo: { do: Op[]; undo: Op[] }[]
  redo: { do: Op[]; undo: Op[] }[]
}

const empty = (): Pick<DawState, 'project' | 'lanes' | 'clips' | 'audio' | 'undo' | 'redo'> => ({ project: null, lanes: {}, clips: {}, audio: {}, undo: [], redo: [] })
export const useDaw = create<DawState>(() => ({ ...empty(), loading: false, error: null }))
const get = useDaw.getState, set = useDaw.setState

export const newId = () => crypto.randomUUID()
export const sortedLanes = (lanes: Record<string, StudioLane>) => Object.values(lanes).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
export const clipEnd = (c: StudioClip) => c.start_ms + c.length_ms
/** The project's length: its last clip's end (ms). */
export const projectEnd = (clips: Record<string, StudioClip>) => Object.values(clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)

let loadingId: string | null = null
/** Load a project (or clear with null). */
export async function loadProject(id: string | null) {
  if (!id) { loadingId = null; engine.stop(); set({ ...empty(), loading: false, error: null }); return }
  loadingId = id
  if (get().project?.id !== id) { engine.stop(); set({ ...empty(), loading: true, error: null }) }
  try {
    const full = await api.get<StudioProjectFull>(`/studio/projects/${id}`)
    if (loadingId !== id) return
    const keep = get().project?.id === id
    set({ project: full.project, lanes: byId(full.lanes), clips: byId(full.clips), audio: byId(full.audio), loading: false, error: null, ...(keep ? {} : { undo: [], redo: [] }) })
    engine.preload()
  } catch (e) { if (loadingId === id) set({ loading: false, error: (e as Error).message }) }
}
const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]))

/** Apply ops to the local project. */
function applyLocal(ops: (Op | Applied)[]) {
  const s = get()
  if (!s.project) return
  const project = { ...s.project }, lanes = { ...s.lanes }, clips = { ...s.clips }
  for (const o of ops) {
    if (o.op === 'project') Object.assign(project, 'project' in o ? o.project : { ...o, op: undefined })
    else if (o.op === 'lane.put') lanes[o.lane.id] = { ...(lanes[o.lane.id] ?? { project_id: project.id, name: t('Track'), color: null, position: 0, gain: 1, pan: 0, mute: false, solo: false, user_id: null }), ...o.lane } as StudioLane
    else if (o.op === 'lane.del') { delete lanes[o.id]; for (const c of Object.values(clips)) if (c.lane_id === o.id) delete clips[c.id] }
    else if (o.op === 'clip.put') clips[o.clip.id] = { ...(clips[o.clip.id] ?? { project_id: project.id, start_ms: 0, in_ms: 0, gain: 1, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: null }), ...o.clip } as StudioClip
    else if (o.op === 'clip.del') delete clips[o.id]
  }
  delete (project as Partial<StudioProject> & { op?: unknown }).op
  set({ project, lanes, clips })
}

/** The ops that undo `ops`, from the project as it is before them. */
function inverse(ops: Op[]): Op[] {
  const { project, lanes, clips } = get()
  const out: Op[] = []
  const pick = <T extends object>(from: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (from as Record<string, unknown>)[k]]))
  for (const o of ops) {
    if (o.op === 'project' && project) out.unshift({ op: 'project', ...pick(project, Object.keys(o).filter((k) => k !== 'op')) })
    else if (o.op === 'lane.put') out.unshift(lanes[o.lane.id] ? { op: 'lane.put', lane: { id: o.lane.id, ...pick(lanes[o.lane.id], Object.keys(o.lane)) } } : { op: 'lane.del', id: o.lane.id })
    else if (o.op === 'lane.del' && lanes[o.id]) out.unshift({ op: 'lane.put', lane: { ...lanes[o.id] } }, ...Object.values(clips).filter((c) => c.lane_id === o.id).map((c): Op => ({ op: 'clip.put', clip: { ...c } })))
    else if (o.op === 'clip.put') out.unshift(clips[o.clip.id] ? { op: 'clip.put', clip: { id: o.clip.id, ...pick(clips[o.clip.id], Object.keys(o.clip)) } } : { op: 'clip.del', id: o.clip.id })
    else if (o.op === 'clip.del' && clips[o.id]) out.unshift({ op: 'clip.put', clip: { ...clips[o.id] } })
  }
  return out
}

let queue: Promise<unknown> = Promise.resolve()
/** Send ops to the server, in order. A refusal reloads the project (our optimistic copy is wrong). */
function send(ops: Op[]) {
  const pid = get().project?.id
  if (!pid || !ops.length) return
  queue = queue.then(() => api.post(`/studio/projects/${pid}/ops`, { ops })).catch((e: Error) => {
    useStore.getState().pushToast(e.message, 'error')
    void loadProject(pid)
  })
}

/** Make an edit: applied here at once, sent to everyone, undoable. `merge` folds it into the previous edit (a drag). */
export function edit(ops: Op[], opts: { merge?: boolean; undoable?: boolean } = {}) {
  if (!ops.length || !get().project) return
  const undo = inverse(ops)
  applyLocal(ops)
  send(ops)
  if (opts.undoable === false) return
  const st = get()
  if (opts.merge && st.undo.length) {
    const last = st.undo[st.undo.length - 1]
    set({ undo: [...st.undo.slice(0, -1), { do: [...last.do, ...ops], undo: [...undo, ...last.undo] }], redo: [] })
  } else set({ undo: [...st.undo.slice(-199), { do: ops, undo }], redo: [] })
}

const live = new Map<string, { ops: Op[]; timer: ReturnType<typeof setTimeout> }>()
/**
 * An edit made continuously (a fader, a knob): applied here at once, sent to everyone a moment after it stops moving,
 * and undone in one step. `key` names the control.
 */
export function editLive(key: string, ops: Op[]) {
  if (!ops.length || !get().project) return
  const pending = live.get(key)
  if (!pending) {
    const undo = inverse(ops)
    const st = get()
    set({ undo: [...st.undo.slice(-199), { do: ops, undo, key } as { do: Op[]; undo: Op[] }], redo: [] })
  } else {
    clearTimeout(pending.timer)
    const st = get(), last = st.undo[st.undo.length - 1] as { do: Op[]; undo: Op[]; key?: string } | undefined
    if (last?.key === key) set({ undo: [...st.undo.slice(0, -1), { ...last, do: ops }] })
  }
  applyLocal(ops)
  live.set(key, { ops, timer: setTimeout(() => { live.delete(key); send(ops) }, 150) })
}

export function undo() {
  const st = get(), last = st.undo[st.undo.length - 1]
  if (!last) return
  applyLocal(last.undo); send(last.undo)
  set({ undo: st.undo.slice(0, -1), redo: [...st.redo, last] })
}
export function redo() {
  const st = get(), next = st.redo[st.redo.length - 1]
  if (!next) return
  applyLocal(next.do); send(next.do)
  set({ redo: st.redo.slice(0, -1), undo: [...st.undo, next] })
}

/** STUDIO_PROJECT: someone's edit (ours included) as the server applied it. */
export function onRemote(d: { project_id: string; version: number; ops: Applied[] }) {
  const p = get().project
  if (!p || p.id !== d.project_id) return
  if (d.version > p.version + 1) { void loadProject(p.id); return }
  if (d.version <= p.version) return
  applyLocal(d.ops)
  set({ project: { ...get().project!, version: d.version } })
  // Clips on audio we haven't got yet (a take that just landed, someone's import).
  const missing = d.ops.filter((o): o is Extract<Applied, { op: 'clip.put' }> => o.op === 'clip.put').some((o) => !get().audio[o.clip.audio_id])
  if (missing) void loadProject(p.id)
}

/** Import audio files into the studio: each becomes a clip on a new lane (or `lane`), placed at `at` ms. */
export async function importFiles(channelId: string, files: File[], at: number, lane?: string) {
  const toast = useStore.getState().pushToast
  for (const f of files) {
    try {
      const buffer = await engine.decodeFile(f)
      const token = getToken()
      const r = await fetch(`/api/channels/${channelId}/studio/audio?name=${encodeURIComponent(f.name)}&duration_ms=${Math.round(buffer.duration * 1000)}`, { method: 'POST', headers: { 'Content-Type': f.type || 'audio/wav', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: f })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error ?? r.statusText)
      const track = body as StudioTrack
      engine.adopt(track.id, buffer)
      set({ audio: { ...get().audio, [track.id]: track } })
      const lanes = sortedLanes(get().lanes)
      const laneId = lane ?? newId()
      const ops: Op[] = []
      if (!lane) ops.push({ op: 'lane.put', lane: { id: laneId, name: f.name.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 80), position: (lanes[lanes.length - 1]?.position ?? -1) + 1 } })
      ops.push({ op: 'clip.put', clip: { id: newId(), lane_id: laneId, audio_id: track.id, start_ms: Math.max(0, Math.round(at)), in_ms: 0, length_ms: Math.max(1, Math.round(buffer.duration * 1000)) } })
      edit(ops)
    } catch (e) { toast(t('Couldn’t import {name}: {error}', { name: f.name, error: (e as Error).message }), 'error') }
  }
}

/** Put a recorded take (from the Sessions panel) into the project: on its member's lane, or a new one, at `at`. */
export function addTake(track: StudioTrack, at: number) {
  const s = get()
  if (!s.project || !track.duration_ms) return
  set({ audio: { ...s.audio, [track.id]: track } })
  const lane = sortedLanes(s.lanes).find((l) => track.user_id && l.user_id === track.user_id)
  const laneId = lane?.id ?? newId()
  const ops: Op[] = []
  if (!lane) ops.push({ op: 'lane.put', lane: { id: laneId, name: track.display_name, position: (sortedLanes(s.lanes).pop()?.position ?? -1) + 1, ...(track.user_id ? { user_id: track.user_id } : {}) } })
  ops.push({ op: 'clip.put', clip: { id: newId(), lane_id: laneId, audio_id: track.id, start_ms: Math.max(0, Math.round(at)), in_ms: 0, length_ms: track.duration_ms } })
  edit(ops)
  void engine.preload()
}

/** Audible lanes: not muted, and soloed when anything is. */
export function audible(lanes: Record<string, StudioLane>, id: string) {
  const l = lanes[id]
  if (!l || l.mute) return false
  return !Object.values(lanes).some((x) => x.solo) || l.solo
}

type Bus = { gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode }
type Decoded = { buffer: AudioBuffer; peaks: Float32Array; top: number }

/** A clip's gain envelope (clip gain, fades) on `param`, for playback starting `from` ms into the clip at `when`. */
function envelope(param: AudioParam, c: StudioClip, when: number, from: number) {
  const len = c.length_ms, fi = c.fade_in_ms, fo = c.fade_out_ms, g = c.gain
  const at = (ms: number) => when + (ms - from) / 1000
  const level = (ms: number) => g * Math.min(fi > 0 ? Math.min(1, ms / fi) : 1, fo > 0 ? Math.min(1, (len - ms) / fo) : 1)
  param.setValueAtTime(level(from), when)
  if (fi > 0 && from < fi) param.linearRampToValueAtTime(level(fi), at(fi))
  if (fo > 0) { const s = Math.max(from, len - fo); if (s > from) param.setValueAtTime(level(s), at(s)); param.linearRampToValueAtTime(0, at(len)) }
}

/** The engine: decodes, plays the project, meters, renders. One per app; it follows the open project. */
class Engine {
  ctx: AudioContext | null = null
  private decoded = new Map<string, Promise<Decoded>>()
  private ready = new Map<string, Decoded>()
  private sources: AudioBufferSourceNode[] = []
  private buses = new Map<string, Bus>()
  private master: { gain: GainNode; analyser: AnalyserNode } | null = null
  private clickTimer: ReturnType<typeof setInterval> | null = null
  private meterBuf = new Float32Array(1024)
  /** Playing: the context time of timeline 0 (so position = currentTime - t0), and whether it is the take's backing. */
  private t0 = 0
  playing: false | 'local' | 'backing' = false
  private listeners = new Set<() => void>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private click = false

  audio() { return (this.ctx ??= new AudioContext({ latencyHint: 'interactive' })) }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  private emit() { this.listeners.forEach((f) => f()); this.expose() }

  /** Seconds on the timeline now (0 when stopped). */
  position() { return this.playing && this.ctx ? Math.max(0, this.ctx.currentTime - this.t0) : 0 }

  /** Decoded audio of a file, once it has loaded (for waveforms). */
  peek(id: string) { return this.ready.get(id) }

  async decodeFile(f: Blob): Promise<AudioBuffer> { return this.audio().decodeAudioData(await f.arrayBuffer()) }
  adopt(id: string, buffer: AudioBuffer) { const d = this.prep(buffer); this.ready.set(id, d); this.decoded.set(id, Promise.resolve(d)); this.emit() }
  private prep(buffer: AudioBuffer): Decoded { const peaks = peaksOf(buffer); let top = 0; for (const p of peaks) if (p > top) top = p; return { buffer, peaks, top } }

  load(track: StudioTrack): Promise<Decoded> {
    let p = this.decoded.get(track.id)
    if (!p) {
      p = (async () => {
        const token = getToken()
        const r = await fetch(track.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!r.ok) throw new Error(`${track.name ?? track.display_name}: ${r.status}`)
        const d = this.prep(await this.audio().decodeAudioData(await r.arrayBuffer()))
        this.ready.set(track.id, d); this.emit()
        return d
      })()
      p.catch(() => this.decoded.delete(track.id))
      this.decoded.set(track.id, p)
    }
    return p
  }

  /** Decode everything the project's clips use. */
  async preload() {
    const { clips, audio } = get()
    const ids = [...new Set(Object.values(clips).map((c) => c.audio_id))]
    await Promise.all(ids.map((id) => (audio[id] ? this.load(audio[id]).catch(() => null) : null)))
  }

  /** Play from `fromSec` on the timeline, starting at context time `when` (default: now). */
  play(fromSec: number, opts: { when?: number; backing?: boolean; click?: boolean } = {}) {
    const ctx = this.audio()
    ctx.resume().catch(() => {})
    this.stop(true)
    const { lanes, clips, project } = get()
    if (!project) return
    const when = Math.max(ctx.currentTime + 0.03, opts.when ?? ctx.currentTime + 0.05)
    this.t0 = when - fromSec
    this.click = !!opts.click
    const mg = ctx.createGain(); mg.gain.value = project.master_gain
    const ma = ctx.createAnalyser(); ma.fftSize = 1024
    mg.connect(ma).connect(ctx.destination)
    this.master = { gain: mg, analyser: ma }
    for (const l of Object.values(lanes)) {
      const gain = ctx.createGain(), pan = ctx.createStereoPanner(), analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      gain.connect(pan).connect(analyser).connect(mg)
      this.buses.set(l.id, { gain, pan, analyser })
    }
    this.mix()
    const fromMs = fromSec * 1000
    for (const c of Object.values(clips)) {
      if (c.muted || clipEnd(c) <= fromMs) continue
      const d = this.ready.get(c.audio_id), bus = this.buses.get(c.lane_id)
      if (!d || !bus) continue
      const into = Math.max(0, fromMs - c.start_ms)
      const at = when + Math.max(0, c.start_ms - fromMs) / 1000
      const src = ctx.createBufferSource(); src.buffer = d.buffer
      const env = ctx.createGain()
      envelope(env.gain, c, at, into)
      src.connect(env).connect(bus.gain)
      src.start(at, (c.in_ms + into) / 1000, (c.length_ms - into) / 1000)
      this.sources.push(src)
    }
    if (opts.click) {
      const beat = 60 / project.bpm, beats = project.beats || 4
      let n = Math.ceil(fromSec / beat - 1e-6)
      const tick = () => {
        const now = ctx.currentTime - this.t0
        while (n * beat < now + 0.12) { if (n * beat >= now - 0.01) clickAt(ctx, ctx.destination, this.t0 + n * beat, n % beats === 0); n++ }
      }
      tick(); this.clickTimer = setInterval(tick, 25)
    }
    this.playing = opts.backing ? 'backing' : 'local'
    this.emit()
  }

  stop(quiet = false) {
    this.sources.forEach((n) => { try { n.stop() } catch { /* not started */ } })
    this.sources = []
    this.buses.forEach((b) => { b.gain.disconnect(); b.pan.disconnect(); b.analyser.disconnect() }); this.buses.clear()
    this.master?.gain.disconnect(); this.master?.analyser.disconnect(); this.master = null
    if (this.clickTimer) clearInterval(this.clickTimer); this.clickTimer = null
    if (this.playing) { this.playing = false; if (!quiet) this.emit() }
  }

  /** Lane levels, pans, mutes and solos, and the master, onto what is playing. */
  mix() {
    const { lanes, project } = get()
    this.buses.forEach((b, id) => { const l = lanes[id]; b.gain.gain.value = l && audible(lanes, id) ? l.gain : 0; b.pan.pan.value = l?.pan ?? 0 })
    if (this.master && project) this.master.gain.gain.value = project.master_gain
  }

  /** The project changed while playing: pick up from where we are (clips moved, lanes added). */
  refresh() {
    this.mix()
    if (!this.playing) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => { if (this.playing && this.ctx) { const mode = this.playing; this.play(this.position(), { backing: mode === 'backing', click: this.click }) } }, 60)
  }

  /** Level 0..1 of a lane or 'master' while playing. */
  level(id: string) {
    const a = id === 'master' ? this.master?.analyser : this.buses.get(id)?.analyser
    if (!a) return 0
    const buf = this.meterBuf
    a.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.6)
  }

  /** From hearing the project to the mic capturing what is played along (output plus input latency), in ms. */
  latencyMs(stream?: MediaStream | null) {
    const ctx = this.audio()
    const out = ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) + (ctx.baseLatency || 0)
    const input = (stream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number } | undefined)?.latency || 0
    return Math.round((out + input) * 1000)
  }

  /** The project mixed down offline (the audible lanes, clip gains and fades, the master) as a WAV. */
  async render(): Promise<ArrayBuffer | null> {
    const { lanes, clips, project } = get()
    if (!project) return null
    await this.preload()
    const end = projectEnd(clips) / 1000
    if (end <= 0) return null
    const rate = 48000
    const off = new OfflineAudioContext(2, Math.ceil(end * rate) + rate / 10, rate)
    const mg = off.createGain(); mg.gain.value = project.master_gain; mg.connect(off.destination)
    for (const l of Object.values(lanes)) {
      if (!audible(lanes, l.id)) continue
      const g = off.createGain(); g.gain.value = l.gain
      const p = off.createStereoPanner(); p.pan.value = l.pan
      g.connect(p).connect(mg)
      for (const c of Object.values(clips).filter((x) => x.lane_id === l.id && !x.muted)) {
        const d = this.ready.get(c.audio_id)
        if (!d) continue
        const src = off.createBufferSource(); src.buffer = d.buffer
        const env = off.createGain(); envelope(env.gain, c, c.start_ms / 1000, 0)
        src.connect(env).connect(g)
        src.start(c.start_ms / 1000, c.in_ms / 1000, c.length_ms / 1000)
      }
    }
    return encodeWav(await off.startRendering())
  }

  private expose() { (window as unknown as { __parleyDaw?: unknown }).__parleyDaw = { playing: this.playing, decoded: this.ready.size, sources: this.sources.length, position: this.position() } }
}

export const engine = new Engine()

/** Export the project's mix as a WAV download. */
export async function exportMix() {
  const p = get().project
  const wav = await engine.render()
  if (!p || !wav) return
  ;(window as unknown as { __parleyDawExport?: number }).__parleyDawExport = wav.byteLength
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
  const { download } = await import('./fileActions')
  await download(url, `${p.name} - mix.wav`)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Keep the open project of the studio we are in loaded, and play it as the backing while a take records into it:
 * from the take's playhead, starting on its downbeat (count-in included), for everyone in the studio, band and
 * audience alike. It plays on this device, so it never reaches the recordings (the band wears headphones).
 */
function follow() {
  let backingFor: string | null = null
  const sync = () => {
    const s = useStore.getState()
    const ch = s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] : undefined
    const pid = ch?.kind === 'studio' ? ch.studio?.project_id ?? null : null
    if (pid && get().project?.id !== pid && loadingId !== pid) void loadProject(pid)
    const live: StudioSession | undefined = ch ? s.studio[ch.id]?.find((x) => !x.ended_at) : undefined
    const take = live && live.project_id && live.project_id === get().project?.id ? live : undefined
    if (take && backingFor !== take.id) {
      backingFor = take.id
      void engine.preload().then(() => {
        if (backingFor !== take.id) return
        const ctx = engine.audio()
        const downbeat = Date.parse(take.started_at)
        const late = Math.max(0, (Date.now() - downbeat) / 1000)
        engine.play((take.position_ms ?? 0) / 1000 + late, { when: ctx.currentTime + Math.max(0, downbeat - Date.now()) / 1000, backing: true })
      })
    } else if (!take && backingFor) { backingFor = null; if (engine.playing === 'backing') engine.stop() }
  }
  useStore.subscribe((s, prev) => { if (s.studio !== prev.studio || s.myVoiceChannelId !== prev.myVoiceChannelId || s.channels !== prev.channels) sync() })
  useDaw.subscribe((s, prev) => {
    if (s.project?.id !== prev.project?.id) sync()
    // Moved, trimmed or new clips (and new lanes) reschedule what is playing; level changes just apply.
    const laneSet = (x: DawState) => Object.keys(x.lanes).sort().join()
    if (s.clips !== prev.clips || (s.lanes !== prev.lanes && laneSet(s) !== laneSet(prev))) engine.refresh()
    else if (s.lanes !== prev.lanes || s.project?.master_gain !== prev.project?.master_gain) engine.mix()
  })
}
if (typeof window !== 'undefined') follow()
