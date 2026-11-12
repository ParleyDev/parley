import { create } from 'zustand'
import { api, getToken } from './api'
import { clickAt, encodeWav, peaksOf } from './multitrack'
import { buildChain, chainKey, integratedLufs, type FxNode, type Target } from './fx'
import { beatsAt, isDownbeat, secAtBeat } from './tempo'
import { scheduleNotes } from './instruments'
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
  | ({ op: 'project' } & Partial<Pick<StudioProject, 'name' | 'bpm' | 'beats' | 'master_gain' | 'master_effects' | 'tempo_map' | 'loop_on' | 'loop_start_ms' | 'loop_end_ms' | 'punch_on' | 'markers'>>)
  | { op: 'lane.put'; lane: Partial<StudioLane> & { id: string } }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: Partial<StudioClip> & { id: string } }
  | { op: 'clip.del'; id: string }
/** What the server broadcasts: puts carry the whole entity. */
type Applied =
  | { op: 'project'; project: Partial<StudioProject> }
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
  /** Comments pinned to the timeline. */
  comments: StudioComment[]
  /** Where the others editing are: playhead, playing, selection (by user, with when it was heard). */
  peers: Record<string, { pos_ms: number; playing: boolean; sel: string[]; at: number }>
}
export interface StudioComment { id: string; project_id: string; user_id: string | null; ms: number; lane_id: string | null; body: string; resolved: boolean; created_at: string }

const empty = (): Pick<DawState, 'project' | 'lanes' | 'clips' | 'audio' | 'undo' | 'redo' | 'comments' | 'peers'> => ({ project: null, lanes: {}, clips: {}, audio: {}, undo: [], redo: [], comments: [], peers: {} })
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
    void loadComments()
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
export function onRemote(d: { project_id: string; version: number; ops: Applied[]; reload?: boolean }) {
  const p = get().project
  if (!p || p.id !== d.project_id) return
  // A version restored: start from the project as it now is (our undo history no longer applies).
  if (d.reload) { set({ undo: [], redo: [] }); void loadProject(p.id); return }
  if (d.version > p.version + 1) { void loadProject(p.id); return }
  if (d.version <= p.version) return
  applyLocal(d.ops)
  set({ project: { ...get().project!, version: d.version } })
  // Clips on audio we haven't got yet (a take that just landed, someone's import).
  const missing = d.ops.filter((o): o is Extract<Applied, { op: 'clip.put' }> => o.op === 'clip.put').some((o) => !!o.clip.audio_id && !get().audio[o.clip.audio_id])
  if (missing) void loadProject(p.id)
}

export async function loadComments() {
  const p = get().project
  if (!p) return
  try { const list = await api.get<StudioComment[]>(`/studio/projects/${p.id}/comments`); if (get().project?.id === p.id) set({ comments: list }) } catch { /* ignore */ }
}
/** STUDIO_COMMENTS: someone commented, resolved or deleted. */
export function onComments(d: { project_id: string }) { if (get().project?.id === d.project_id) void loadComments() }

/** STUDIO_PRESENCE: where another editor is. */
export function onPresence(d: { project_id: string; user_id: string; pos_ms: number; playing: boolean; sel: string[] }) {
  if (get().project?.id !== d.project_id || d.user_id === useStore.getState().user?.id) return
  set({ peers: { ...get().peers, [d.user_id]: { pos_ms: d.pos_ms, playing: d.playing, sel: d.sel, at: Date.now() } } })
}
let lastPresence = '', presenceAt = 0, presenceTimer: ReturnType<typeof setTimeout> | null = null
/** Tell the others where I am (at most four times a second, and only when it changed). */
export function sharePresence(posMs: number, playing: boolean, sel: string[]) {
  const p = get().project
  if (!p) return
  const key = `${Math.round(posMs / 100)}|${playing}|${sel.join()}`
  if (key === lastPresence) return
  const go = () => { presenceTimer = null; lastPresence = key; presenceAt = Date.now(); api.post(`/studio/projects/${p.id}/presence`, { pos_ms: Math.round(posMs), playing, sel: sel.slice(0, 50) }).catch(() => {}) }
  if (presenceTimer) clearTimeout(presenceTimer)
  const wait = 250 - (Date.now() - presenceAt)
  if (wait <= 0) go(); else presenceTimer = setTimeout(go, wait)
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
/** Where someone's takes land: the audio track they most recently made theirs (as the server places them). */
export const takeLane = (lanes: Record<string, StudioLane>, uid: string | null | undefined) =>
  uid ? sortedLanes(lanes).filter((l) => l.kind === 'audio' && l.user_id === uid).sort((a, b) => (b.claimed_at ?? '').localeCompare(a.claimed_at ?? ''))[0] : undefined

export function addTake(track: StudioTrack, at: number) {
  const s = get()
  if (!s.project || !track.duration_ms) return
  set({ audio: { ...s.audio, [track.id]: track } })
  const lane = takeLane(s.lanes, track.user_id)
  const laneId = lane?.id ?? newId()
  const ops: Op[] = []
  if (!lane) ops.push({ op: 'lane.put', lane: { id: laneId, name: track.display_name, position: (sortedLanes(s.lanes).pop()?.position ?? -1) + 1, ...(track.user_id ? { user_id: track.user_id } : {}) } })
  ops.push({ op: 'clip.put', clip: { id: newId(), lane_id: laneId, audio_id: track.id, start_ms: Math.max(0, Math.round(at)), in_ms: 0, length_ms: track.duration_ms } })
  edit(ops)
  void engine.preload()
}

/** Audible lanes: not muted, and soloed when anything is. Buses stay audible under solo (they carry the solo). */
export function audible(lanes: Record<string, StudioLane>, id: string) {
  const l = lanes[id]
  if (!l || l.mute) return false
  if (l.kind === 'bus') return true
  return !Object.values(lanes).some((x) => x.solo && x.kind !== 'bus') || l.solo
}

type Decoded = { buffer: AudioBuffer; peaks: Float32Array; top: number }
type Point = [number, number]

/** A clip's gain envelope (clip gain, fades) on `param`, for playback starting `from` ms into the clip at `when`. */
function envelope(param: AudioParam, c: StudioClip, when: number, from: number) {
  const len = c.length_ms, fi = c.fade_in_ms, fo = c.fade_out_ms, g = c.gain
  const at = (ms: number) => when + (ms - from) / 1000
  const level = (ms: number) => g * Math.min(fi > 0 ? Math.min(1, ms / fi) : 1, fo > 0 ? Math.min(1, (len - ms) / fo) : 1)
  param.setValueAtTime(level(from), when)
  if (fi > 0 && from < fi) param.linearRampToValueAtTime(level(fi), at(fi))
  if (fo > 0) { const s = Math.max(from, len - fo); if (s > from) param.setValueAtTime(level(s), at(s)); param.linearRampToValueAtTime(0, at(len)) }
}

/** An automation lane's value at `ms` (held before the first point and after the last). */
export function valueAt(pts: Point[], ms: number) {
  if (!pts.length) return 0
  if (ms <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i]
    if (ms <= t1) { const [t0, v0] = pts[i - 1]; return t1 === t0 ? v1 : v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0) }
  }
  return pts[pts.length - 1][1]
}
/** Ramp `param` along `pts` for playback from `from` ms on the timeline, at context time `when`. */
function automate(param: AudioParam, pts: Point[], from: number, when: number, to: (v: number) => number = (v) => v) {
  param.cancelScheduledValues(when)
  param.setValueAtTime(to(valueAt(pts, from)), when)
  for (const [t, v] of pts) if (t > from) param.linearRampToValueAtTime(to(v), when + (t - from) / 1000)
}

type LaneNodes = { input: GainNode; fx: Map<string, FxNode>; vol: GainNode; pan: StereoPannerNode; on: GainNode; analyser: AnalyserNode; sends: Map<string, GainNode> }
type Graph = { lanes: Map<string, LaneNodes>; master: { input: GainNode; fx: Map<string, FxNode>; gain: GainNode; analyser: AnalyserNode; loud: AnalyserNode | null }; key: string; stop: () => void }

/** The graph's shape: lanes, routing, effect chains and what is automated. A change means rebuilding it. */
export function graphKey(lanes: Record<string, StudioLane>, project: StudioProject | null) {
  return [chainKey(project?.master_effects ?? []), ...sortedLanes(lanes).map((l) => [l.id, l.kind, l.output_id ?? '', Object.keys(l.sends ?? {}).sort().join('+'), chainKey(l.effects ?? []), Object.keys(l.automation ?? {}).sort().join('+'), l.instrument ? JSON.stringify(l.instrument) : ''].join('|'))].join('\n')
}

/**
 * The mixer as Web Audio nodes: per lane input → insert effects → volume → pan → mute/solo → meter → its output (a
 * bus or the master), with post-fader sends to buses; the master: input → master effects → level → meter → speakers
 * (and a K-weighted tap for the loudness meter when live).
 */
function buildGraph(ctx: BaseAudioContext, lanes: Record<string, StudioLane>, project: StudioProject, live: boolean): Graph {
  const minput = ctx.createGain(), mgain = ctx.createGain(), manalyser = ctx.createAnalyser()
  manalyser.fftSize = 1024
  const mfx = buildChain(ctx, project.master_effects ?? [], minput, mgain)
  mgain.connect(manalyser).connect(ctx.destination)
  let loud: AnalyserNode | null = null
  if (live) {
    const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5
    loud = ctx.createAnalyser(); loud.fftSize = 16384
    mgain.connect(shelf).connect(hp).connect(loud)
  }
  const nodes = new Map<string, LaneNodes>()
  const make = (l: StudioLane, out: AudioNode) => {
    const input = ctx.createGain(), vol = ctx.createGain(), pan = ctx.createStereoPanner(), on = ctx.createGain(), analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const fx = buildChain(ctx, l.effects ?? [], input, vol)
    vol.connect(pan).connect(on).connect(analyser).connect(out)
    const n: LaneNodes = { input, fx, vol, pan, on, analyser, sends: new Map() }
    nodes.set(l.id, n)
    return n
  }
  const all = sortedLanes(lanes)
  for (const l of all) if (l.kind === 'bus') make(l, minput)
  for (const l of all) {
    if (l.kind === 'bus') continue
    const n = make(l, (l.output_id && nodes.get(l.output_id)?.input) || minput)
    for (const bus of Object.keys(l.sends ?? {})) {
      const target = nodes.get(bus)
      if (!target) continue
      const g = ctx.createGain(); n.on.connect(g).connect(target.input); n.sends.set(bus, g)
    }
  }
  const g: Graph = { lanes: nodes, master: { input: minput, fx: mfx, gain: mgain, analyser: manalyser, loud }, key: graphKey(lanes, project),
    stop: () => { mfx.forEach((f) => f.stop()); nodes.forEach((n) => { n.fx.forEach((f) => f.stop()); n.analyser.disconnect(); n.on.disconnect() }); manalyser.disconnect(); mgain.disconnect() } }
  applyMix(g, lanes, project)
  return g
}

/** Levels, pans, mutes, sends and effect settings onto the graph (what automation doesn't drive). */
function applyMix(g: Graph, lanes: Record<string, StudioLane>, project: StudioProject) {
  for (const [id, n] of g.lanes) {
    const l = lanes[id]
    if (!l) continue
    const auto = l.automation ?? {}
    if (!auto.gain) n.vol.gain.value = l.gain
    if (!auto.pan) n.pan.pan.value = l.pan
    n.on.gain.value = audible(lanes, id) ? 1 : 0
    for (const [bus, s] of n.sends) if (!auto[`send:${bus}`]) s.gain.value = l.sends?.[bus] ?? 0
    for (const e of l.effects ?? []) n.fx.get(e.id)?.set(e)
  }
  g.master.gain.gain.value = project.master_gain
  for (const e of project.master_effects ?? []) g.master.fx.get(e.id)?.set(e)
}

/** Where an automation key lands in the graph. */
function target(g: Graph, laneId: string, key: string): Target | null {
  const n = g.lanes.get(laneId)
  if (!n) return null
  if (key === 'gain') return { param: n.vol.gain }
  if (key === 'pan') return { param: n.pan.pan }
  if (key.startsWith('send:')) { const s = n.sends.get(key.slice(5)); return s ? { param: s.gain } : null }
  if (key.startsWith('fx:')) { const [, id, p] = key.split(':'); return n.fx.get(id)?.targets[p] ?? null }
  return null
}

/** Start every lane's automation for playback from `from` ms at `when`. */
function scheduleAutomation(g: Graph, lanes: Record<string, StudioLane>, from: number, when: number) {
  for (const l of Object.values(lanes)) {
    for (const [key, pts] of Object.entries(l.automation ?? {})) {
      const tg = target(g, l.id, key)
      if (tg && pts.length) automate(tg.param, pts as Point[], from, when, tg.to)
    }
  }
}

/** The engine: decodes, plays the project, meters, renders. One per app; it follows the open project. */
class Engine {
  ctx: AudioContext | null = null
  private decoded = new Map<string, Promise<Decoded>>()
  private ready = new Map<string, Decoded>()
  private sources: AudioScheduledSourceNode[] = []
  private graph: Graph | null = null
  private clickTimer: ReturnType<typeof setInterval> | null = null
  private meterBuf = new Float32Array(1024)
  private loudBuf = new Float32Array(16384)
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
  position() {
    if (!this.playing || !this.ctx) return 0
    const ms = Math.max(0, this.ctx.currentTime - this.t0) * 1000, l = this.loopAt
    return (l && ms >= l.b ? l.a + ((ms - l.a) % (l.b - l.a)) : ms) / 1000
  }

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
    const ids = [...new Set(Object.values(clips).map((c) => c.audio_id).filter((x): x is string => !!x))]
    await Promise.all(ids.map((id) => (audio[id] ? this.load(audio[id]).catch(() => null) : null)))
  }

  /** Schedule the clips that sound in [from, to) ms on the timeline, timeline 0 being context time `t0`. */
  private schedule(ctx: BaseAudioContext, g: Graph, clips: Record<string, StudioClip>, lanes: Record<string, StudioLane>, from: number, to: number, t0: number, out: AudioScheduledSourceNode[]) {
    for (const c of Object.values(clips)) {
      const lane = lanes[c.lane_id]
      if (c.muted || !lane) continue
      const nudge = lane.nudge_ms ?? 0
      const start = c.start_ms + nudge, end = start + c.length_ms
      if (end <= from || start >= to) continue
      const bus = g.lanes.get(c.lane_id)
      if (!bus) continue
      if (c.notes) { const sid = (lane.instrument as { audio_id?: string | null } | null)?.audio_id; scheduleNotes(ctx, bus.input, lane, c, start, from, to, t0, out, sid ? this.ready.get(sid)?.buffer : undefined); continue }
      const d = c.audio_id ? this.ready.get(c.audio_id) : undefined
      if (!d) continue
      const into = Math.max(0, from - start)
      const at = t0 + Math.max(from, start) / 1000
      const dur = (Math.min(end, to) - Math.max(from, start)) / 1000
      const src = ctx.createBufferSource(); src.buffer = d.buffer
      const env = ctx.createGain()
      envelope(env.gain, c, at, into)
      src.connect(env).connect(bus.input)
      src.start(at, (c.in_ms + into) / 1000, dur)
      out.push(src)
    }
  }

  /** Play from `fromSec` on the timeline, starting at context time `when` (default: now). With the loop on, it loops. */
  play(fromSec: number, opts: { when?: number; backing?: boolean; click?: boolean; loop?: { a: number; b: number } | null } = {}) {
    const ctx = this.audio()
    ctx.resume().catch(() => {})
    this.stop(true)
    const { lanes, clips, project } = get()
    if (!project) return
    const when = Math.max(ctx.currentTime + 0.03, opts.when ?? ctx.currentTime + 0.05)
    this.click = !!opts.click
    const g = this.graph = buildGraph(ctx, lanes, project, true)
    const loop = opts.loop !== undefined ? opts.loop : !opts.backing && project.loop_on && (project.loop_end_ms ?? 0) > (project.loop_start_ms ?? 0) + 50 ? { a: project.loop_start_ms!, b: project.loop_end_ms! } : null
    let from = fromSec * 1000
    if (loop && (from >= loop.b || from < loop.a)) from = loop.a
    this.t0 = when - from / 1000
    this.loopAt = loop
    // One pass now; with a loop, the next passes are queued a little before each ends.
    const pass = (a: number, b: number, t0: number) => {
      this.schedule(ctx, g, clips, lanes, a, b, t0, this.sources)
      scheduleAutomation(g, lanes, a, t0 + a / 1000)
      if (opts.click && loop) for (let n = Math.ceil(beatsAt(project, a / 1000) - 1e-6); secAtBeat(project, n) * 1000 < b; n++) clickAt(ctx, ctx.destination, t0 + secAtBeat(project, n), isDownbeat(project, n))
    }
    pass(from, loop ? loop.b : Infinity, this.t0)
    if (loop) {
      let end = this.t0 + loop.b / 1000
      this.loopTimer = setInterval(() => {
        if (ctx.currentTime < end - 0.3) return
        const next = end - loop.a / 1000
        pass(loop.a, loop.b, next)
        end = next + loop.b / 1000
      }, 50)
    } else if (opts.click) {
      let n = Math.ceil(beatsAt(project, from / 1000) - 1e-6)
      const tick = () => {
        const now = ctx.currentTime - this.t0
        for (;;) {
          const at = secAtBeat(project, n)
          if (at >= now + 0.12) break
          if (at >= now - 0.01) clickAt(ctx, ctx.destination, this.t0 + at, isDownbeat(project, n))
          n++
        }
      }
      tick(); this.clickTimer = setInterval(tick, 25)
    }
    this.playing = opts.backing ? 'backing' : 'local'
    this.emit()
  }
  private loopAt: { a: number; b: number } | null = null
  private loopTimer: ReturnType<typeof setInterval> | null = null

  stop(quiet = false) {
    this.sources.forEach((n) => { try { n.stop() } catch { /* not started */ } })
    this.sources = []
    this.graph?.stop(); this.graph = null
    if (this.clickTimer) clearInterval(this.clickTimer); this.clickTimer = null
    if (this.loopTimer) clearInterval(this.loopTimer); this.loopTimer = null
    this.loopAt = null
    if (this.playing) { this.playing = false; if (!quiet) this.emit() }
  }

  /** Levels, pans, mutes, sends and effect settings onto what is playing. */
  mix() {
    const { lanes, project } = get()
    if (this.graph && project) applyMix(this.graph, lanes, project)
  }

  /** The project changed while playing: pick up from where we are (clips moved, the routing or effects changed). */
  refresh() {
    this.mix()
    if (!this.playing) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => { if (this.playing && this.ctx) { const mode = this.playing; this.play(this.position(), { backing: mode === 'backing', click: this.click, ...(mode === 'backing' ? { loop: this.loopAt } : {}) }) } }, 60)
  }
  /** Rebuild if the graph's shape no longer matches the project. */
  reshape() {
    const { lanes, project } = get()
    if (this.graph && this.graph.key !== graphKey(lanes, project)) this.refresh()
    else this.mix()
  }

  /** Level 0..1 of a lane or 'master' while playing. */
  level(id: string) {
    const a = id === 'master' ? this.graph?.master.analyser : this.graph?.lanes.get(id)?.analyser
    if (!a) return 0
    const buf = this.meterBuf
    a.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.6)
  }
  /** The master's momentary loudness (LUFS, about the last 0.35 s), null when stopped or silent. */
  loudness(): number | null {
    const a = this.graph?.master.loud
    if (!a) return null
    a.getFloatTimeDomainData(this.loudBuf)
    let sum = 0
    for (let i = 0; i < this.loudBuf.length; i++) sum += this.loudBuf[i] * this.loudBuf[i]
    const ms = sum / this.loudBuf.length
    // The analyser hears the channels averaged; for a stereo mix that reads about 3 dB under their sum.
    return ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) + 3.01 : null
  }

  /** From hearing the project to the mic capturing what is played along (output plus input latency), in ms. */
  latencyMs(stream?: MediaStream | null) {
    const ctx = this.audio()
    const out = ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) + (ctx.baseLatency || 0)
    const input = (stream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number } | undefined)?.latency || 0
    return Math.round((out + input) * 1000)
  }

  /**
   * The project rendered offline (effects, buses, automation, clip gains and fades, the master): the whole mix, or
   * only `only` lane(s) for stems.
   */
  async renderBuffer(only?: string[]): Promise<AudioBuffer | null> {
    const { lanes, clips, project } = get()
    if (!project) return null
    await this.preload()
    const end = projectEnd(clips) / 1000
    if (end <= 0) return null
    const rate = 48000
    // A tail for reverbs and delays to ring out.
    const tail = Object.values(lanes).some((l) => (l.effects ?? []).some((e) => e.on && (e.type === 'reverb' || e.type === 'delay'))) || (project.master_effects ?? []).some((e) => e.on && (e.type === 'reverb' || e.type === 'delay')) ? 3 : 0.1
    const off = new OfflineAudioContext(2, Math.ceil((end + tail) * rate), rate)
    let ls = lanes
    if (only) {
      // A stem: the lane(s) and the buses they reach, everything else silent.
      const keep = new Set(only)
      for (const id of only) { const l = lanes[id]; if (l?.output_id) keep.add(l.output_id); for (const b of Object.keys(l?.sends ?? {})) keep.add(b) }
      ls = Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, keep.has(id) ? { ...l, mute: false, solo: false } : { ...l, mute: true }]))
    }
    const g = buildGraph(off, ls, project, false)
    const out: AudioScheduledSourceNode[] = []
    this.schedule(off, g, clips, ls, 0, Infinity, 0, out)
    scheduleAutomation(g, ls, 0, 0)
    return off.startRendering()
  }
  async render(): Promise<ArrayBuffer | null> { const b = await this.renderBuffer(); return b ? encodeWav(b) : null }

  private expose() { (window as unknown as { __parleyDaw?: unknown }).__parleyDaw = { playing: this.playing, decoded: this.ready.size, sources: this.sources.length, position: this.position(), graph: this.graph ? this.graph.lanes.size : 0, loop: this.loopAt } }
}

export const engine = new Engine()

/** Export the project's mix as a WAV download, and say how loud it is. */
export async function exportMix() {
  const p = get().project
  const buf = await engine.renderBuffer()
  if (!p || !buf) return
  const wav = encodeWav(buf)
  const lufs = await integratedLufs(buf)
  ;(window as unknown as { __parleyDawExport?: number; __parleyDawLufs?: number | null }).__parleyDawExport = wav.byteLength
  ;(window as unknown as { __parleyDawLufs?: number | null }).__parleyDawLufs = lufs
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
  const { download } = await import('./fileActions')
  await download(url, `${p.name} - mix.wav`)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  if (lufs !== null) useStore.getState().pushToast(t('Mix exported · {lufs} LUFS integrated', { lufs: lufs.toFixed(1) }))
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
    const pid = ch?.kind === 'project' ? ch.studio?.project_id ?? null : null
    if (pid && get().project?.id !== pid && loadingId !== pid) void loadProject(pid)
    const live: StudioSession | undefined = ch ? s.studio[ch.id]?.find((x) => !x.ended_at) : undefined
    // A take recorded alone is backed only for whoever records it.
    const take = live && live.project_id && live.project_id === get().project?.id && (!live.solo || live.started_by === s.user?.id) ? live : undefined
    if (take && backingFor !== take.id) {
      backingFor = take.id
      void engine.preload().then(() => {
        if (backingFor !== take.id) return
        const ctx = engine.audio()
        const downbeat = Date.parse(take.started_at)
        // Loop recording loops the backing too; a punch plays straight through.
        const loop = take.loop_start_ms != null && take.loop_end_ms != null && !take.punch ? { a: take.loop_start_ms, b: take.loop_end_ms } : null
        let at = (take.position_ms ?? 0) + Math.max(0, Date.now() - downbeat)
        if (loop && at >= loop.b) at = loop.a + ((at - loop.a) % (loop.b - loop.a))
        engine.play(at / 1000, { when: ctx.currentTime + Math.max(0, downbeat - Date.now()) / 1000, backing: true, loop, click: take.click })
      })
    } else if (!take && backingFor) { backingFor = null; if (engine.playing === 'backing') engine.stop() }
  }
  useStore.subscribe((s, prev) => { if (s.studio !== prev.studio || s.myVoiceChannelId !== prev.myVoiceChannelId || s.channels !== prev.channels) sync() })
  useDaw.subscribe((s, prev) => {
    if (s.project?.id !== prev.project?.id) sync()
    // Moved, trimmed or new clips (and new lanes) reschedule what is playing; level changes just apply.
    if (s.clips !== prev.clips) engine.refresh()
    else if (s.lanes !== prev.lanes || s.project !== prev.project) engine.reshape()
  })
}
if (typeof window !== 'undefined') follow()
