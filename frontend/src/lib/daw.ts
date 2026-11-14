import { create } from 'zustand'
import { api, ApiError, getToken } from './api'
import { clickAt, clicksPlayed, peaksOf } from './multitrack'
import { encodeWav } from './wav'
import { analyserReading, isClipped, clearClip, latchClip, studioModule, type Reading } from './meters'
import { buildChain, chainKey, type FxNode, type Target } from './fx'
import { beatsAt, isDownbeat, secAtBeat } from './tempo'
import { scheduleNotes } from './instruments'
import { useStore } from '../store'
import { STORAGE_PREFIX } from './brand'
import { serverNow, syncClock, toLocal } from './clock'
import { t } from './i18n'
import { applyOps, audible, clipEnd, inverseOps, projectEnd, sortedLanes, valueAt, type Applied, type Op, type Point } from './dawops'
import type { StudioClip, StudioLane, StudioProject, StudioProjectFull, StudioSession, StudioTrack } from './types'

/**
 * The studio's DAW on the client: the open project (lanes, clips, the audio they use), edits, and the audio engine.
 *
 * Edits are ops, applied here at once and sent to the server, which applies them for everyone and broadcasts them
 * (STUDIO_PROJECT): everyone editing sees the same project live. Each edit of your own keeps its inverse, so undo and
 * redo send ops too. Ops from others arrive with the entities they left and the project's version; a gap in versions
 * reloads the project. Edits wait in an outbox until the server has them: a connection that is down is retried and
 * the edits stay as made (`sync` says so); an edit the server refuses is taken back, on its own.
 *
 * The engine decodes every clip's audio once, plays the project from any position through a bus per lane (gain, pan,
 * mute / solo, meter) into the master, and renders it offline for export. While a take records into the project,
 * everyone in the studio hears the project from where the take started, in time with the take's downbeat: that is
 * the backing the band plays over (see `follow`).
 */

export type { Op } from './dawops'

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
  /** Follow the project's shared playback (on unless turned off here, remembered on this device). */
  follow: boolean
  /** My edits and the server: all there, on their way, or waiting for the connection (`unsent` of them). */
  sync: 'saved' | 'saving' | 'offline'
  unsent: number
}
export interface StudioComment { id: string; project_id: string; user_id: string | null; ms: number; lane_id: string | null; body: string; resolved: boolean; created_at: string }

const empty = (): Pick<DawState, 'project' | 'lanes' | 'clips' | 'audio' | 'undo' | 'redo' | 'comments' | 'peers'> => ({ project: null, lanes: {}, clips: {}, audio: {}, undo: [], redo: [], comments: [], peers: {} })
const FOLLOW_KEY = `${STORAGE_PREFIX}dawFollow`
export const useDaw = create<DawState>(() => ({ ...empty(), loading: false, error: null, sync: 'saved', unsent: 0, follow: (() => { try { return localStorage.getItem(FOLLOW_KEY) !== '0' } catch { return true } })() }))
const get = useDaw.getState, set = useDaw.setState

/** Every project runs at one rate: takes are captured at it and the mix is rendered at it. */
export const PROJECT_RATE = 48000

export const newId = () => crypto.randomUUID()
export { audible, clipEnd, projectEnd, sortedLanes, valueAt }

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
    held.clear()
    // Edits of mine the server has not got yet are still mine: on top of what it has.
    rebase(id)
    engine.preload()
    void loadComments()
  } catch (e) {
    if (loadingId !== id) return
    // Taking an open project again (after a reconnect, a gap in its events): what is on screen stays, with the
    // unsent edits, and it is asked for again until the server answers. Only a refusal ends that.
    if (get().project?.id === id && !refused(e)) { if (!again) again = setTimeout(() => { again = null; if (get().project?.id === id) void loadProject(id) }, 2000); return }
    set({ loading: false, error: (e as Error).message })
  }
}
let again: ReturnType<typeof setTimeout> | null = null
const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]))

/** Apply ops to the local project. */
function applyLocal(ops: (Op | Applied)[]) {
  const s = get()
  if (s.project) set(applyOps({ project: s.project, lanes: s.lanes, clips: s.clips }, ops, t('Track')))
}

/** The ops that undo `ops`, from the project as it is before them. */
const inverse = (ops: Op[]) => inverseOps(get(), ops)

/** Edits the server has not got yet, oldest first. They are sent one at a time, in the order they were made. */
const outbox: { pid: string; ops: Op[] }[] = []
/** The first of them is with the server now (its answer has not come back). */
let inflight = false
let pumping = false, tries = 0, wake: (() => void) | null = null
const noteSync = (offline = false) => set({ unsent: outbox.length, sync: !outbox.length ? 'saved' : offline ? 'offline' : 'saving' })
/** The server said no (as against not being reached, or being unwell: those are tried again). */
const refused = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && ![408, 425, 429].includes(e.status)

/** Send ops to the server, in order. */
function send(ops: Op[]) {
  const pid = get().project?.id
  if (!pid || !ops.length) return
  outbox.push({ pid, ops })
  noteSync(get().sync === 'offline')
  void pump()
}

async function pump() {
  if (pumping) return
  pumping = true
  while (outbox.length) {
    const b = outbox[0]
    try {
      inflight = true
      await api.post(`/studio/projects/${b.pid}/ops`, { ops: b.ops })
      inflight = false
      outbox.shift(); tries = 0; noteSync()
    } catch (e) {
      inflight = false
      if (refused(e)) {
        // That edit did not happen: it goes (from the undo history too), the ones after it stay. The project is
        // taken from the server again with them on top, since what we showed was the project with it.
        outbox.shift(); tries = 0
        useStore.getState().pushToast((e as Error).message, 'error')
        forget(b.ops)
        if (get().project?.id === b.pid) await loadProject(b.pid)
        noteSync()
        continue
      }
      // Not reached: the edits stay as made and it is tried again, sooner when the connection is known to be back.
      tries++
      noteSync(true)
      await new Promise<void>((r) => { const timer = setTimeout(r, Math.min(8000, 500 * 2 ** (tries - 1))); wake = () => { clearTimeout(timer); r() } })
      wake = null
    }
  }
  pumping = false
}

/** Drop a refused edit from the undo and redo history: there is nothing to undo, or to do again. */
function forget(ops: Op[]) {
  const has = (e: { do: Op[]; undo: Op[] }) => e.do === ops || e.undo === ops || ops.some((o) => e.do.includes(o) || e.undo.includes(o))
  const st = get()
  if (st.undo.some(has) || st.redo.some(has)) set({ undo: st.undo.filter((e) => !has(e)), redo: st.redo.filter((e) => !has(e)) })
}

/** Put my unsent edits back on top of the project (after it was loaded, or someone's edit was applied under them). */
function rebase(pid: string) {
  for (const b of outbox.slice(inflight ? 1 : 0)) if (b.pid === pid) applyLocal(b.ops)
  for (const l of live.values()) applyLocal(l.ops)
}

/** The connection is back (or may be): send what is waiting now. */
export function retrySync() { wake?.() }
/** A fresh connection, with whatever happened meanwhile missed: the open project is taken from the server again. */
export function onReconnect() {
  retrySync()
  const p = get().project
  if (p) void loadProject(p.id)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', retrySync)
  // Leaving with edits the server has not got loses them: the browser asks first.
  window.addEventListener('beforeunload', (e) => { if (outbox.length || live.size) e.preventDefault() })
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

type Remote = { project_id: string; version: number; ops: Applied[]; reload?: boolean }
/** Edits that arrived ahead of the one before them (two servers' events can cross): kept a moment for it to come. */
const held = new Map<number, Remote>()
let heldTimer: ReturnType<typeof setTimeout> | null = null

/** STUDIO_PROJECT: someone's edit (ours included) as the server applied it. */
export function onRemote(d: Remote) {
  const p = get().project
  if (!p || p.id !== d.project_id) return
  // A version restored: start from the project as it now is (our undo history no longer applies).
  if (d.reload) { set({ undo: [], redo: [] }); void loadProject(p.id); return }
  if (d.version > p.version + 1) {
    // Ahead of what we have: the one in between is late, or was missed (then the project is loaded again).
    held.set(d.version, d)
    heldTimer ??= setTimeout(() => { heldTimer = null; const q = get().project; if (held.size && q) { held.clear(); void loadProject(q.id) } }, 400)
    return
  }
  if (d.version <= p.version) return
  applyLocal(d.ops)
  set({ project: { ...get().project!, version: d.version } })
  rebase(p.id)
  const next = held.get(d.version + 1)
  if (next) { held.delete(d.version + 1); onRemote(next) }
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
/** Turn following the shared playback on or off on this device. */
export function setFollow(on: boolean) {
  try { localStorage.setItem(FOLLOW_KEY, on ? '1' : '0') } catch { /* ignore */ }
  set({ follow: on })
  if (!on && engine.playing === 'shared') engine.stop()
}

/** Play (from `fromMs`) or stop the project for everyone in it. */
export async function sharedTransport(playing: boolean, fromMs: number) {
  const p = get().project
  if (!p) return
  await syncClock()
  const r = await api.post<{ play_from_ms: number; play_at: string | null; play_by: string }>(`/studio/projects/${p.id}/transport`, { playing, position_ms: Math.round(fromMs) })
  onTransport({ project_id: p.id, ...r })
}

/** STUDIO_TRANSPORT: the shared playback changed. */
export function onTransport(d: { project_id: string; play_from_ms: number; play_at: string | null; play_by: string | null }) {
  const p = get().project
  if (!p || p.id !== d.project_id) return
  set({ project: { ...p, play_from_ms: d.play_from_ms, play_at: d.play_at, play_by: d.play_by } })
}

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
/**
 * Arm a track (or disarm it), like a desktop DAW's exclusive arm: arming one of a member's tracks disarms their others,
 * unless `keep` (Ctrl / Cmd-click: several inputs at once). `claim` also makes it the member's.
 */
export function armLane(id: string, on: boolean, keep = false, claim?: string) {
  const { lanes } = get()
  const l = lanes[id]
  if (!l) return
  const owner = claim ?? l.user_id
  const ops: Op[] = [{ op: 'lane.put', lane: { id, armed: on, ...(claim ? { user_id: claim } : {}) } }]
  if (on && !keep && owner) for (const o of Object.values(lanes)) if (o.id !== id && o.kind === 'audio' && o.user_id === owner && o.armed) ops.push({ op: 'lane.put', lane: { id: o.id, armed: false } })
  edit(ops)
}

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

/** Ramp `param` along `pts` for playback from `from` ms on the timeline, at context time `when`. */
function automate(param: AudioParam, pts: Point[], from: number, when: number, to: (v: number) => number = (v) => v) {
  param.cancelScheduledValues(when)
  param.setValueAtTime(to(valueAt(pts, from)), when)
  for (const [t, v] of pts) if (t > from) param.linearRampToValueAtTime(to(v), when + (t - from) / 1000)
}

type LaneNodes = { input: GainNode; fx: Map<string, FxNode>; vol: GainNode; pan: StereoPannerNode; on: GainNode; analyser: AnalyserNode; sends: Map<string, GainNode> }
type Graph = { lanes: Map<string, LaneNodes>; master: { input: GainNode; fx: Map<string, FxNode>; gain: GainNode; analyser: AnalyserNode; loud: AnalyserNode | null }; key: string; stop: () => void; unwatch?: () => void }

/** The graph's shape: lanes, routing, effect chains and what is automated. A change means rebuilding it. */
export function graphKey(lanes: Record<string, StudioLane>, project: StudioProject | null) {
  return [chainKey(project?.master_effects ?? []), ...sortedLanes(lanes).map((l) => [l.id, l.kind, l.output_id ?? '', l.sends_only ? 'sends' : '', Object.keys(l.sends ?? {}).sort().join('+'), chainKey(l.effects ?? []), Object.keys(l.automation ?? {}).sort().join('+'), l.instrument ? JSON.stringify(l.instrument) : ''].join('|'))].join('\n')
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
  const make = (l: StudioLane, out: AudioNode | null) => {
    const input = ctx.createGain(), vol = ctx.createGain(), pan = ctx.createStereoPanner(), on = ctx.createGain(), analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const fx = buildChain(ctx, l.effects ?? [], input, vol)
    const tail = vol.connect(pan).connect(on).connect(analyser)
    if (out) tail.connect(out)
    const n: LaneNodes = { input, fx, vol, pan, on, analyser, sends: new Map() }
    nodes.set(l.id, n)
    return n
  }
  const all = sortedLanes(lanes)
  for (const l of all) if (l.kind === 'bus') make(l, minput)
  for (const l of all) {
    if (l.kind === 'bus') continue
    // "Sends only": heard through its sends, not its output.
    const n = make(l, l.sends_only ? null : (l.output_id && nodes.get(l.output_id)?.input) || minput)
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
  /** Every file this page has loaded, by id: the project's list is replaced on a reload and may lack one for a moment. */
  private tracks = new Map<string, StudioTrack>()
  private sources: AudioScheduledSourceNode[] = []
  private graph: Graph | null = null
  private clickTimer: ReturnType<typeof setInterval> | null = null
  /** What the meter processor last said of each strip: the peak (falling back between reports) and the mean square. */
  private readings = new Map<string, { peak: number; ms: number }>()
  private loudBuf = new Float32Array(16384)
  /** Playing: the context time of timeline 0 (so position = currentTime - t0), and whether it is the take's backing. */
  private t0 = 0
  playing: false | 'local' | 'backing' | 'shared' = false
  private listeners = new Set<() => void>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private click = false

  /** The studio's one audio context, at the project's rate (a device that cannot run at it runs at its own). */
  audio() {
    if (!this.ctx) {
      // Tests set a device rate to stand in for hardware that cannot run at the project's.
      const device = (window as unknown as { __parleyDawDeviceRate?: number }).__parleyDawDeviceRate
      try { this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: device ?? PROJECT_RATE }) }
      catch { this.ctx = new AudioContext({ latencyHint: 'interactive' }) }
      setInterval(() => this.heardLatency(), 500)
    }
    return this.ctx
  }
  /**
   * The output latency the browser reports, as it has lately been: the figure wanders, and reads zero for a moment
   * whenever the output restarts, so a take is placed by the middle of the last few readings.
   */
  private outLatency: number[] = []
  private heardLatency() {
    const v = (this.ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency
    if (this.ctx?.state === 'running' && v && v > 0) { this.outLatency.push(v); if (this.outLatency.length > 9) this.outLatency.shift() }
  }
  private beats = new Map<string, number>()
  /**
   * A take's downbeat (a server time) on this context's clock. The backing, the click and the recorder all time
   * themselves from this one number, so a take lines up with what was heard to the sample, whatever the device's
   * clock does meanwhile. Settled once per take, while the context runs (call after syncClock()).
   */
  downbeat(session: string, serverStart: number) {
    const ctx = this.audio()
    const have = this.beats.get(session)
    if (have !== undefined) return have
    const at = ctx.currentTime + (toLocal(serverStart) - Date.now()) / 1000
    if (ctx.state === 'running') { this.beats.clear(); this.beats.set(session, at) }
    return at
  }
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
    this.tracks.set(track.id, track)
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
  private schedule(ctx: BaseAudioContext, g: Graph, clips: Record<string, StudioClip>, lanes: Record<string, StudioLane>, from: number, to: number, t0: number, out: AudioScheduledSourceNode[], buf: (id: string) => AudioBuffer | undefined = (id) => this.ready.get(id)?.buffer) {
    for (const c of Object.values(clips)) {
      const lane = lanes[c.lane_id]
      if (c.muted || !lane) continue
      const nudge = lane.nudge_ms ?? 0
      const start = c.start_ms + nudge, end = start + c.length_ms
      if (end <= from || start >= to) continue
      const bus = g.lanes.get(c.lane_id)
      if (!bus) continue
      if (c.notes) { const sid = (lane.instrument as { audio_id?: string | null } | null)?.audio_id; scheduleNotes(ctx, bus.input, lane, c, start, from, to, t0, out, sid ? buf(sid) : undefined); continue }
      const d = c.audio_id ? buf(c.audio_id) : undefined
      if (!d) continue
      const into = Math.max(0, from - start)
      const at = t0 + Math.max(from, start) / 1000
      const dur = (Math.min(end, to) - Math.max(from, start)) / 1000
      const src = ctx.createBufferSource(); src.buffer = d
      const env = ctx.createGain()
      envelope(env.gain, c, at, into)
      src.connect(env).connect(bus.input)
      src.start(at, (c.in_ms + into) / 1000, dur)
      out.push(src)
    }
  }

  /** Play from `fromSec` on the timeline, starting at context time `when` (default: now). With the loop on, it loops. */
  play(fromSec: number, opts: { when?: number; backing?: boolean; shared?: boolean; click?: boolean; loop?: { a: number; b: number } | null } = {}) {
    const ctx = this.audio()
    ctx.resume().catch(() => {})
    this.stop(true)
    const { lanes, clips, project } = get()
    if (!project) return
    const when = Math.max(ctx.currentTime + 0.03, opts.when ?? ctx.currentTime + 0.05)
    this.click = !!opts.click
    const g = this.graph = buildGraph(ctx, lanes, project, true)
    if (this.tapBus) g.master.analyser.connect(this.tapBus)
    this.watch(ctx, g)
    const loop = opts.loop !== undefined ? opts.loop : !opts.backing && project.loop_on && (project.loop_end_ms ?? 0) > (project.loop_start_ms ?? 0) + 50 ? { a: project.loop_start_ms!, b: project.loop_end_ms! } : null
    let from = fromSec * 1000
    // Asked to start at a moment that is already here: start as soon as possible, that much further in.
    const late = opts.when !== undefined && when > opts.when
    if (late) from += (when - opts.when!) * 1000
    if (loop && late && from >= loop.b) from = loop.a + ((from - loop.a) % (loop.b - loop.a))
    else if (loop && (from >= loop.b || from < loop.a)) from = loop.a
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
    this.playing = opts.backing ? 'backing' : opts.shared ? 'shared' : 'local'
    this.emit()
  }
  private loopAt: { a: number; b: number } | null = null
  private loopTimer: ReturnType<typeof setInterval> | null = null

  stop(quiet = false) {
    this.sources.forEach((n) => { try { n.stop() } catch { /* not started */ } })
    this.sources = []
    this.graph?.unwatch?.(); this.graph?.stop(); this.graph = null
    this.readings.clear()
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
    this.refreshTimer = setTimeout(() => { if (this.playing && this.ctx) { const mode = this.playing; this.play(this.position(), { when: this.ctx.currentTime, backing: mode === 'backing', shared: mode === 'shared', click: this.click, ...(mode === 'backing' ? { loop: this.loopAt } : {}) }) } }, 60)
  }
  /** Rebuild if the graph's shape no longer matches the project. */
  reshape() {
    const { lanes, project } = get()
    if (this.graph && this.graph.key !== graphKey(lanes, project)) this.refresh()
    else this.mix()
  }

  /**
   * The meter processor onto the graph that plays: an input per strip after its fader, pan and mute, the last for
   * the master after its fader. Until it is loaded (and where there are no worklets) the analysers are read.
   */
  private watch(ctx: AudioContext, g: Graph) {
    if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) return
    void studioModule(ctx).then(() => {
      if (this.graph !== g) return
      const ids = [...g.lanes.keys(), 'master']
      const node = new AudioWorkletNode(ctx, 'parley-meter', { numberOfInputs: ids.length, numberOfOutputs: 1, outputChannelCount: [1] })
      // Pulled by the output, silently.
      const sink = ctx.createGain(); sink.gain.value = 0
      node.connect(sink).connect(ctx.destination)
      ids.forEach((id, i) => (id === 'master' ? g.master.gain : g.lanes.get(id)!.on).connect(node, 0, i))
      node.port.onmessage = (e: MessageEvent<{ peak: Float32Array; ms: Float32Array; over: Uint8Array; frames: number }>) => {
        if (this.graph !== g) return
        const { peak, ms, over, frames } = e.data
        // The mean square settles over about 0.3 s; the peak falls back about 40 dB a second between reports.
        const k = 1 - Math.exp(-frames / ctx.sampleRate / 0.3), fall = Math.pow(10, (-40 * frames) / ctx.sampleRate / 20)
        ids.forEach((id, i) => {
          const r = this.readings.get(id)
          this.readings.set(id, r ? { peak: Math.max(peak[i], r.peak * fall), ms: r.ms + (ms[i] - r.ms) * k } : { peak: peak[i], ms: ms[i] })
          if (over[i]) latchClip(id)
        })
      }
      g.unwatch = () => { node.port.onmessage = null; node.port.postMessage('stop'); node.disconnect(); sink.disconnect() }
    }).catch(() => {})
  }

  /** The level of a lane or 'master' while playing (null when stopped): peak and RMS, 1 being full scale. */
  meter(id: string): Reading | null {
    if (!this.graph) return null
    const r = this.readings.get(id)
    if (r) return { peak: r.peak, rms: Math.sqrt(r.ms) }
    const a = id === 'master' ? this.graph.master.analyser : this.graph.lanes.get(id)?.analyser
    if (!a) return null
    const seen = analyserReading(a)
    if (seen.peak > 1) latchClip(id)
    return seen
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
    this.heardLatency()
    const seen = [...this.outLatency].sort((x, y) => x - y)
    const out = (seen.length ? seen[seen.length >> 1] : 0) + (ctx.baseLatency || 0)
    const input = (stream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number } | undefined)?.latency || 0
    return Math.round((out + input) * 1000)
  }

  /**
   * The audio a render needs (every clip that sounds, every sampler's sample), decoded at the project's rate: all of
   * it, or an error naming what is missing. A render never goes ahead without a part of the project.
   */
  private async material(lanes: Record<string, StudioLane>, clips: Record<string, StudioClip>): Promise<Map<string, AudioBuffer>> {
    const { audio } = get()
    const ids = new Set<string>()
    for (const c of Object.values(clips)) if (c.audio_id && !c.muted && lanes[c.lane_id]) ids.add(c.audio_id)
    for (const l of Object.values(lanes)) { const a = (l.instrument as { audio_id?: string | null } | null)?.audio_id; if (a) ids.add(a) }
    // On a device that runs at another rate the page's copies were resampled to it: the render decodes its own.
    const same = this.audio().sampleRate === PROJECT_RATE
    const out = new Map<string, AudioBuffer>()
    await Promise.all([...ids].map(async (id) => {
      const track = audio[id] ?? this.tracks.get(id)
      if (!track) throw new Error(t('Some of the project\'s audio has not loaded yet. Try again in a moment.'))
      try { out.set(id, same ? (await this.load(track)).buffer : await this.decodeAt(track, PROJECT_RATE)) }
      catch { throw new Error(t('Could not load "{name}", so nothing was rendered.', { name: track.name ?? track.display_name ?? id })) }
    }))
    return out
  }
  private async decodeAt(track: StudioTrack, rate: number): Promise<AudioBuffer> {
    const token = getToken()
    const r = await fetch(track.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!r.ok) throw new Error(String(r.status))
    return new OfflineAudioContext(1, 1, rate).decodeAudioData(await r.arrayBuffer())
  }

  /**
   * The project rendered offline (effects, buses, automation, clip gains and fades, the master) at the project's
   * rate, whatever the device runs at: the whole mix, or only `only` lane(s) for stems. Solo is for listening and is
   * not part of a render (`heard` keeps it, to render what is heard); mute is. A stem is what its lane(s) put into
   * the mix: with nothing on the master, the stems of all tracks add up to it.
   */
  async renderBuffer(only?: string[], heard = false): Promise<AudioBuffer | null> {
    const { lanes, clips, project } = get()
    if (!project) return null
    const end = projectEnd(clips) / 1000
    if (end <= 0) return null
    const bufs = await this.material(lanes, clips)
    const rate = PROJECT_RATE
    // A tail for reverbs and delays to ring out.
    const tail = Object.values(lanes).some((l) => (l.effects ?? []).some((e) => e.on && (e.type === 'reverb' || e.type === 'delay'))) || (project.master_effects ?? []).some((e) => e.on && (e.type === 'reverb' || e.type === 'delay')) ? 3 : 0.1
    const off = new OfflineAudioContext(2, Math.ceil((end + tail) * rate), rate)
    let ls = heard ? lanes : Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, l.solo ? { ...l, solo: false } : l]))
    if (only) {
      // A stem: the lane(s) and the buses they reach, everything else silent.
      const keep = new Set(only)
      for (const id of only) { const l = lanes[id]; if (l?.output_id) keep.add(l.output_id); for (const b of Object.keys(l?.sends ?? {})) keep.add(b) }
      ls = Object.fromEntries(Object.entries(ls).map(([id, l]) => [id, keep.has(id) ? l : { ...l, mute: true, solo: false }]))
    }
    const g = buildGraph(off, ls, project, false)
    const out: AudioScheduledSourceNode[] = []
    this.schedule(off, g, clips, ls, 0, Infinity, 0, out, (id) => bufs.get(id))
    scheduleAutomation(g, ls, 0, 0)
    return off.startRendering()
  }
  async render(bits: 16 | 24 = 24): Promise<ArrayBuffer | null> { const b = await this.renderBuffer(); return b ? encodeWav(b, bits) : null }

  private tapBus: GainNode | null = null
  private tapNode: MediaStreamAudioDestinationNode | null = null
  /** What plays, after the master, as a node of the engine's context (the click is not in it). */
  bus(): AudioNode {
    if (!this.tapBus) { this.tapBus = this.audio().createGain(); this.graph?.master.analyser.connect(this.tapBus) }
    return this.tapBus
  }
  /** The same as a stream. Tests record it to hear what was played. */
  tap(): MediaStream {
    if (!this.tapNode) { this.tapNode = this.audio().createMediaStreamDestination(); this.bus().connect(this.tapNode) }
    return this.tapNode.stream
  }

  private expose() { (window as unknown as { __parleyDaw?: unknown }).__parleyDaw = { playing: this.playing, decoded: this.ready.size, sources: this.sources.length, position: this.position(), graph: this.graph ? this.graph.lanes.size : 0, loop: this.loopAt } }
}

export const engine = new Engine()
// For tests: the rendered project (or a stem) as samples and as the exported WAV, and what plays as a stream.
if (typeof window !== 'undefined') (window as unknown as { __parleyDawTest?: unknown }).__parleyDawTest = { render: (only?: string[], heard?: boolean) => engine.renderBuffer(only, heard), wav: (bits?: 16 | 24) => engine.render(bits), meter: (id: string) => { const r = engine.meter(id); return r && { ...r, clip: isClipped(id) } }, clearClip, tap: () => engine.tap(), bus: () => engine.bus(), context: () => engine.audio(), clicks: clicksPlayed, edit, undo, remote: onRemote, state: () => get() }

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
    // Everyone in the project hears the backing of a take, a take recorded alone included.
    const take = live && live.project_id && live.project_id === get().project?.id ? live : undefined
    if (take && backingFor !== take.id) {
      backingFor = take.id
      void Promise.all([engine.preload(), syncClock()]).then(() => {
        if (backingFor !== take.id) return
        const ctx = engine.audio()
        // On the audio clock: the take's times are the server's.
        const downbeat = engine.downbeat(take.id, Date.parse(take.started_at))
        // Loop recording loops the backing too; a punch plays straight through.
        const loop = take.loop_start_ms != null && take.loop_end_ms != null && !take.punch ? { a: take.loop_start_ms, b: take.loop_end_ms } : null
        let at = (take.position_ms ?? 0) + Math.max(0, ctx.currentTime - downbeat) * 1000
        if (loop && at >= loop.b) at = loop.a + ((at - loop.a) % (loop.b - loop.a))
        engine.play(at / 1000, { when: Math.max(downbeat, ctx.currentTime), backing: true, loop, click: take.click })
      })
    } else if (!take && backingFor) { backingFor = null; if (engine.playing === 'backing') engine.stop() }
    if (!take) shared()
  }
  // The project's shared playback, for everyone who has it open or is in its voice room (unless they opted out).
  let sharedAt: string | null = null
  const shared = () => {
    const { project, follow: on } = get()
    if (engine.playing === 'backing') return
    const at = on && project?.play_at ? project.play_at : null
    if (!at) { sharedAt = null; if (engine.playing === 'shared') engine.stop(); return }
    if (sharedAt === at && engine.playing === 'shared') return
    sharedAt = at
    void Promise.all([engine.preload(), syncClock()]).then(() => {
      const p = get().project
      if (sharedAt !== at || !p || p.play_at !== at) return
      const start = Date.parse(at), now = serverNow()
      engine.play(((p.play_from_ms ?? 0) + Math.max(0, now - start)) / 1000, { when: engine.audio().currentTime + Math.max(0, start - now) / 1000, shared: true })
    })
  }
  useStore.subscribe((s, prev) => { if (s.studio !== prev.studio || s.myVoiceChannelId !== prev.myVoiceChannelId || s.channels !== prev.channels) sync() })
  useDaw.subscribe((s, prev) => {
    if (s.project?.id !== prev.project?.id) sync()
    else if (s.project?.play_at !== prev.project?.play_at || s.follow !== prev.follow) shared()
    // Moved, trimmed or new clips (and new lanes) reschedule what is playing; level changes just apply.
    if (s.clips !== prev.clips) engine.refresh()
    else if (s.lanes !== prev.lanes || s.project !== prev.project) engine.reshape()
  })
}
if (typeof window !== 'undefined') follow()
