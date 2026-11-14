import type { StudioClip, StudioLane, StudioProject } from './types'
import type { Effect } from './fx'
import type { Note } from './instruments'

/**
 * The DAW's project arithmetic, with no store, network or audio in it: what an edit (ops) does to a project, the ops
 * that undo it, and the small questions asked of lanes and clips (order, length, what is audible, an automation
 * lane's value). `daw.ts` runs these against the open project.
 *
 * A field is the unit of an edit: two people changing different fields of one clip both keep their change. The
 * lists inside a field (a clip's notes, a lane's automation points and effects, the master effects, the markers) are
 * edited by item, so two people adding notes to one clip both keep theirs: `itemize` turns an edit that names a whole
 * list into the items it adds, changes and removes, and the server merges them into the list as it then is.
 */

export type Marker = { id: string; ms: number; name: string }
/** Edits to one item of a list. `fx` ops without a lane are the master's. */
export type ItemOp =
  | { op: 'notes'; clip: string; /** `del[k]` is replaced by `add[k]` where both are there. */ add: Note[]; del: Note[] }
  | { op: 'auto'; lane: string; param: string; add: Point[]; del: Point[] }
  | { op: 'fx.put'; lane?: string; /** A whole effect to put in, or the `on` / params of one to change. */ effect: Partial<Effect> & { id: string }; /** Its place in the chain. */ at?: number }
  | { op: 'fx.del'; lane?: string; id: string }
  | { op: 'marker.put'; marker: Partial<Marker> & { id: string } }
  | { op: 'marker.del'; id: string }

export type Op =
  | ({ op: 'project'; /** Drop the loop range (and loop / punch with it). */ clear_loop?: boolean } & Partial<Pick<StudioProject, 'name' | 'bpm' | 'beats' | 'master_gain' | 'master_effects' | 'tempo_map' | 'loop_on' | 'loop_start_ms' | 'loop_end_ms' | 'punch_on' | 'markers'>>)
  | { op: 'lane.put'; lane: Partial<StudioLane> & { id: string } }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: Partial<StudioClip> & { id: string } }
  | { op: 'clip.del'; id: string }
  | ItemOp
/** What the server broadcasts: puts carry the whole entity. */
export type Applied =
  | { op: 'project'; project: Partial<StudioProject> }
  | { op: 'lane.put'; lane: StudioLane }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: StudioClip }
  | { op: 'clip.del'; id: string }

/** A project as ops see it. */
export interface Doc { project: StudioProject; lanes: Record<string, StudioLane>; clips: Record<string, StudioClip> }

export const sortedLanes = (lanes: Record<string, StudioLane>) => Object.values(lanes).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
export const clipEnd = (c: StudioClip) => c.start_ms + c.length_ms
/** The project's length: its last clip's end (ms). */
export const projectEnd = (clips: Record<string, StudioClip>) => Object.values(clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)

/** The project after `ops` (a new one; `doc` is left as it was). A lane made without a name is called `laneName`. */
export function applyOps(doc: Doc, ops: (Op | Applied)[], laneName: string): Doc {
  const project = { ...doc.project }, lanes = { ...doc.lanes }, clips = { ...doc.clips }
  for (const o of ops) {
    if (o.op === 'project') { if ('clear_loop' in o && o.clear_loop) Object.assign(project, { loop_on: false, punch_on: false, loop_start_ms: null, loop_end_ms: null }); else Object.assign(project, 'project' in o ? o.project : { ...o, op: undefined }) }
    else if (o.op === 'lane.put') lanes[o.lane.id] = { ...(lanes[o.lane.id] ?? { project_id: project.id, name: laneName, color: null, position: 0, gain: 1, pan: 0, mute: false, solo: false, user_id: null }), ...o.lane } as StudioLane
    else if (o.op === 'lane.del') { delete lanes[o.id]; for (const c of Object.values(clips)) if (c.lane_id === o.id) delete clips[c.id] }
    else if (o.op === 'clip.put') clips[o.clip.id] = { ...(clips[o.clip.id] ?? { project_id: project.id, start_ms: 0, in_ms: 0, gain: 1, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: null }), ...o.clip } as StudioClip
    else if (o.op === 'clip.del') delete clips[o.id]
    else if (o.op === 'notes') { const c = clips[o.clip]; if (c) clips[c.id] = { ...c, notes: mergeNotes(c.notes ?? [], o.add, o.del) } }
    else if (o.op === 'auto') { const l = lanes[o.lane]; if (l) lanes[l.id] = { ...l, automation: mergePoints(l.automation ?? {}, o.param, o.add, o.del) } }
    else if (o.op === 'fx.put' || o.op === 'fx.del') {
      const change = (list: Effect[]) => (o.op === 'fx.put' ? mergeFx(list, o.effect, o.at) : list.filter((e) => e.id !== o.id))
      if (!o.lane) project.master_effects = change(project.master_effects ?? [])
      else { const l = lanes[o.lane]; if (l) lanes[l.id] = { ...l, effects: change(l.effects ?? []) } }
    }
    else if (o.op === 'marker.put') project.markers = mergeMarker(project.markers ?? [], o.marker)
    else if (o.op === 'marker.del') project.markers = (project.markers ?? []).filter((m) => m.id !== o.id)
  }
  delete (project as Partial<StudioProject> & { op?: unknown }).op
  return { project, lanes, clips }
}

/** Equal as the project holds them: numbers to the precision the server stores, nothing and '' alike. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b))
  const none = (x: unknown) => x == null || x === ''
  if (none(a) || none(b)) return none(a) && none(b)
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined), kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
const sameNote = (a: Note, b: Note) => a.p === b.p && a.t === b.t && a.d === b.d && (a.v ?? 100) === (b.v ?? 100)
const samePoint = (a: Point, b: Point) => a[0] === b[0] && Math.abs(a[1] - b[1]) < 1e-6

// The merges, as the server does them (`merge_notes`, `merge_points`, `merge_fx`, `merge_marker`).

/** Notes with some taken out and some put in: `del[k]` gives its place to `add[k]`. */
export function mergeNotes(cur: Note[], add: Note[], del: Note[]): Note[] {
  const out = [...cur], rest = [...add]
  for (const d of del) {
    const i = out.findIndex((n) => sameNote(n, d)), a = rest.shift()
    if (i >= 0 && a) out[i] = a
    else if (i >= 0) out.splice(i, 1)
    else if (a) out.push(a)
  }
  return [...out, ...rest]
}
/** A lane's automation with points taken off one parameter and put on it. A parameter with none left goes. */
export function mergePoints(cur: Record<string, Point[]>, param: string, add: Point[], del: Point[]): Record<string, Point[]> {
  const pts = [...(cur[param] ?? [])]
  for (const d of del) { const i = pts.findIndex((p) => samePoint(p, d)); if (i >= 0) pts.splice(i, 1) }
  pts.push(...add)
  pts.sort((a, b) => a[0] - b[0])
  const out = { ...cur }
  if (pts.length) out[param] = pts; else delete out[param]
  return out
}
/** An effect chain with one effect changed, put in or moved. One that is gone stays gone unless it comes whole. */
export function mergeFx(cur: Effect[], effect: Partial<Effect> & { id: string }, at?: number): Effect[] {
  const list = [...cur], i = list.findIndex((e) => e.id === effect.id)
  if (i >= 0) {
    list[i] = { ...list[i], ...(typeof effect.on === 'boolean' ? { on: effect.on } : {}), params: { ...list[i].params, ...effect.params } }
    if (at !== undefined) { const [e] = list.splice(i, 1); list.splice(Math.min(at, list.length), 0, e) }
  } else if (effect.type) list.splice(Math.min(at ?? list.length, list.length), 0, { on: true, params: {}, ...effect } as Effect)
  return list
}
/** The markers with one changed or put in. One that is gone stays gone unless it comes whole. */
export function mergeMarker(cur: Marker[], marker: Partial<Marker> & { id: string }): Marker[] {
  const i = cur.findIndex((m) => m.id === marker.id)
  if (i >= 0) return cur.map((m, j) => (j === i ? { ...m, ...(marker.ms !== undefined ? { ms: marker.ms } : {}), ...(marker.name !== undefined ? { name: marker.name } : {}) } : m))
  return marker.ms !== undefined && marker.name !== undefined ? [...cur, marker as Marker] : cur
}

/** What turns the list `old` into `next`, item by item; null where items cannot say it (then the list goes whole). */
function fxDiff(old: Effect[], next: Effect[], lane: string | undefined): ItemOp[] | null {
  const ops: ItemOp[] = []
  const at = lane ? { lane } : {}
  let sim = [...old]
  for (const e of old) if (!next.some((n) => n.id === e.id && n.type === e.type)) { ops.push({ op: 'fx.del', ...at, id: e.id }); sim = sim.filter((x) => x.id !== e.id) }
  next.forEach((n, i) => {
    const j = sim.findIndex((e) => e.id === n.id)
    let op: ItemOp | null = null
    if (j < 0) op = { op: 'fx.put', ...at, effect: n, at: i }
    else {
      const e = sim[j], params = Object.fromEntries(Object.entries(n.params ?? {}).filter(([k, v]) => !same(e.params?.[k], v)))
      const change = { ...(e.on !== n.on ? { on: n.on } : {}), ...(Object.keys(params).length ? { params } : {}) }
      if (j !== i || Object.keys(change).length) op = { op: 'fx.put', ...at, effect: { id: n.id, ...change }, ...(j !== i ? { at: i } : {}) }
    }
    if (op?.op === 'fx.put') { ops.push(op); sim = mergeFx(sim, op.effect, op.at) }
  })
  return same(sim, next) ? ops : null
}
function markerDiff(old: Marker[], next: Marker[]): ItemOp[] | null {
  const ops: ItemOp[] = []
  let sim = [...old]
  for (const m of old) if (!next.some((n) => n.id === m.id)) { ops.push({ op: 'marker.del', id: m.id }); sim = sim.filter((x) => x.id !== m.id) }
  for (const n of next) {
    const m = sim.find((x) => x.id === n.id)
    const marker = m ? { id: n.id, ...(m.ms !== n.ms ? { ms: n.ms } : {}), ...(m.name !== n.name ? { name: n.name } : {}) } : n
    if (m && Object.keys(marker).length === 1) continue
    ops.push({ op: 'marker.put', marker }); sim = mergeMarker(sim, marker)
  }
  return same(sim, next) ? ops : null
}
/** The items of `a` that `b` has no match for (each of `b` matches once). */
function minus<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): T[] {
  const left = [...b]
  return a.filter((x) => { const i = left.findIndex((y) => eq(x, y)); if (i < 0) return true; left.splice(i, 1); return false })
}

const isItem = (o: Op | Applied): o is ItemOp => o.op === 'notes' || o.op === 'auto' || o.op === 'fx.put' || o.op === 'fx.del' || o.op === 'marker.put' || o.op === 'marker.del'

/**
 * `ops` with the lists they name whole (a clip's notes, a lane's automation and effects, the master effects, the
 * markers) said as the items that differ from the project as it is: what is sent, so that someone else's change to
 * another item of the same list is kept. A list is left whole where it is new, or where items cannot say the change.
 */
export function itemize(doc: Doc, ops: Op[]): Op[] {
  const out: Op[] = []
  let cur = doc
  for (const o of ops) {
    const made: Op[] = []
    if (o.op === 'clip.put' && Array.isArray(o.clip.notes) && Array.isArray(cur.clips[o.clip.id]?.notes)) {
      const { notes, ...rest } = o.clip, old = cur.clips[o.clip.id].notes!
      if (Object.keys(rest).length > 1) made.push({ op: 'clip.put', clip: rest })
      const add = minus(notes, old, sameNote), del = minus(old, notes, sameNote)
      if (add.length || del.length) made.push({ op: 'notes', clip: o.clip.id, add, del })
    } else if (o.op === 'lane.put' && cur.lanes[o.lane.id] && (o.lane.automation || o.lane.effects)) {
      const { automation, effects, ...rest } = o.lane, l = cur.lanes[o.lane.id]
      const fx = effects ? fxDiff(l.effects ?? [], effects, l.id) : []
      if (!fx) (rest as Partial<StudioLane>).effects = effects
      if (Object.keys(rest).length > 1) made.push({ op: 'lane.put', lane: rest })
      made.push(...(fx ?? []))
      if (automation) for (const param of new Set([...Object.keys(l.automation ?? {}), ...Object.keys(automation)])) {
        const old = l.automation?.[param] ?? [], next = automation[param] ?? []
        let add = minus(next, old, samePoint), del = minus(old, next, samePoint)
        if (!add.length && !del.length) continue
        // Points at one time are in an order (a step): where merging would not keep it, the parameter goes whole.
        if (!same(mergePoints({ [param]: old }, param, add, del)[param] ?? [], [...next].sort((a, b) => a[0] - b[0]))) { add = next; del = old }
        made.push({ op: 'auto', lane: l.id, param, add, del })
      }
    } else if (o.op === 'project' && !o.clear_loop && (o.master_effects || o.markers)) {
      const { master_effects, markers, ...fields } = o
      const rest: Extract<Op, { op: 'project' }> = fields
      const fx = master_effects ? fxDiff(cur.project.master_effects ?? [], master_effects, undefined) : []
      const marks = markers ? markerDiff(cur.project.markers ?? [], markers) : []
      if (!fx) rest.master_effects = master_effects
      if (!marks) rest.markers = markers
      if (Object.keys(rest).length > 1) made.push(rest)
      made.push(...(fx ?? []), ...(marks ?? []))
    } else { out.push(o); continue }
    out.push(...made)
    if (made.length) cur = applyOps(cur, made, '')
  }
  return out
}

/** The ops that undo `ops`, from the project as it is before them. */
export function inverseOps({ project, lanes, clips }: { project: StudioProject | null; lanes: Record<string, StudioLane>; clips: Record<string, StudioClip> }, ops: Op[]): Op[] {
  const out: Op[] = []
  const pick = <T extends object>(from: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (from as Record<string, unknown>)[k]]))
  // Item ops are undone from the list as the ops before them left it.
  const stepped = !!project && ops.some(isItem)
  for (const o of ops) {
    if (isItem(o) && project) {
      if (o.op === 'notes') out.unshift({ op: 'notes', clip: o.clip, add: o.del, del: o.add })
      else if (o.op === 'auto') out.unshift({ op: 'auto', lane: o.lane, param: o.param, add: o.del, del: o.add })
      else if (o.op === 'fx.put' || o.op === 'fx.del') {
        const list = (o.lane ? lanes[o.lane]?.effects : project.master_effects) ?? [], at = o.lane ? { lane: o.lane } : {}
        const id = o.op === 'fx.put' ? o.effect.id : o.id, i = list.findIndex((e) => e.id === id)
        if (o.op === 'fx.del') { if (i >= 0) out.unshift({ op: 'fx.put', ...at, effect: list[i], at: i }) }
        else if (i < 0) out.unshift({ op: 'fx.del', ...at, id })
        else out.unshift({ op: 'fx.put', ...at, effect: { id, ...(o.effect.on !== undefined ? { on: list[i].on } : {}), ...(o.effect.params ? { params: pick(list[i].params ?? {}, Object.keys(o.effect.params)) as Record<string, number> } : {}) }, ...(o.at !== undefined ? { at: i } : {}) })
      } else {
        const id = o.op === 'marker.put' ? o.marker.id : o.id, m = (project.markers ?? []).find((x) => x.id === id)
        if (o.op === 'marker.del') { if (m) out.unshift({ op: 'marker.put', marker: m }) }
        else out.unshift(m ? { op: 'marker.put', marker: { id, ...pick(m, Object.keys(o.marker)) } } : { op: 'marker.del', id })
      }
    } else
    if (o.op === 'project' && project) out.unshift({ op: 'project', ...pick(project, o.clear_loop ? ['loop_start_ms', 'loop_end_ms', 'loop_on', 'punch_on'] : Object.keys(o).filter((k) => k !== 'op')) })
    else if (o.op === 'lane.put') out.unshift(lanes[o.lane.id] ? { op: 'lane.put', lane: { id: o.lane.id, ...pick(lanes[o.lane.id], Object.keys(o.lane)) } } : { op: 'lane.del', id: o.lane.id })
    else if (o.op === 'lane.del' && lanes[o.id]) out.unshift({ op: 'lane.put', lane: { ...lanes[o.id] } }, ...Object.values(clips).filter((c) => c.lane_id === o.id).map((c): Op => ({ op: 'clip.put', clip: { ...c } })))
    else if (o.op === 'clip.put') out.unshift(clips[o.clip.id] ? { op: 'clip.put', clip: { id: o.clip.id, ...pick(clips[o.clip.id], Object.keys(o.clip)) } } : { op: 'clip.del', id: o.clip.id })
    else if (o.op === 'clip.del' && clips[o.id]) out.unshift({ op: 'clip.put', clip: { ...clips[o.id] } })
    if (stepped) ({ project, lanes, clips } = applyOps({ project: project!, lanes, clips }, [o], ''))
  }
  return out
}

/**
 * `ops` (an undo, or a redo) as they can still be applied without taking back what someone else did since: `was` is
 * the edit of mine they reverse (as the server stored it, where `stored` knows). A field that no longer holds what my
 * edit put there is left as it is, and so is anything on a clip, track, effect or marker that is gone. `dropped`
 * counts what was left.
 */
export function settle(doc: Doc, ops: Op[], was: Op[], stored: (o: Op) => Op = (o) => o): { ops: Op[]; dropped: number } {
  // What my edit left in each field, by entity.
  const left = new Map<string, Record<string, unknown>>(), gone = new Set<string>()
  const note = (key: string, fields: object) => left.set(key, { ...left.get(key), ...fields })
  for (const raw of was) {
    const o = stored(raw)
    if (o.op === 'project') note('project', o.clear_loop ? { loop_on: false, punch_on: false, loop_start_ms: null, loop_end_ms: null } : { ...o, op: undefined })
    else if (o.op === 'lane.put') note(`lane:${o.lane.id}`, o.lane)
    else if (o.op === 'clip.put') note(`clip:${o.clip.id}`, o.clip)
    else if (o.op === 'lane.del' || o.op === 'clip.del') gone.add(o.id)
    else if (o.op === 'fx.put') note(`fx:${o.lane ?? ''}:${o.effect.id}`, { ...(o.effect.on !== undefined ? { on: o.effect.on } : {}), ...Object.fromEntries(Object.entries(o.effect.params ?? {}).map(([k, v]) => [`p:${k}`, v])) })
    else if (o.op === 'fx.del') gone.add(`fx:${o.lane ?? ''}:${o.id}`)
    else if (o.op === 'marker.put') note(`marker:${o.marker.id}`, o.marker)
    else if (o.op === 'marker.del') gone.add(`marker:${o.id}`)
  }
  const out: Op[] = []
  let dropped = 0
  // The fields of a put that are still as my edit left them (all of them, where my edit did not set the field).
  const still = <T extends { id: string }>(key: string, now: object, put: T): T | null => {
    const mine = left.get(key) ?? {}
    const keep = Object.keys(put).filter((k) => k === 'id' || !(k in mine) || mine[k] === undefined || same((now as Record<string, unknown>)[k], mine[k]))
    dropped += Object.keys(put).length - keep.length
    return keep.length > 1 ? Object.fromEntries(keep.map((k) => [k, (put as Record<string, unknown>)[k]])) as T : null
  }
  let cur = doc
  for (const o of ops) {
    let op: Op | null = o
    if (o.op === 'project') { if (!o.clear_loop) { const { id: _, ...kept } = still('project', cur.project, { ...o, id: '' }) ?? { id: '' }; op = Object.keys(kept).length > 1 ? kept as Op : null } }
    else if (o.op === 'lane.put') {
      const l = cur.lanes[o.lane.id]
      if (l) { const lane = still(`lane:${l.id}`, l, o.lane); op = lane ? { op: 'lane.put', lane } : null }
      else if (!gone.has(o.lane.id)) { op = null; dropped++ }
    } else if (o.op === 'clip.put') {
      const c = cur.clips[o.clip.id]
      if (c) { const clip = still(`clip:${c.id}`, c, o.clip); op = clip ? { op: 'clip.put', clip } : null }
      else if (!gone.has(o.clip.id)) { op = null; dropped++ }
      // A clip goes back on its track, or to another: one that is gone takes neither.
      const to = op && op.op === 'clip.put' ? op.clip.lane_id ?? c?.lane_id : undefined
      if (op && to && !cur.lanes[to]) { op = null; dropped++ }
    } else if (o.op === 'lane.del') { if (!cur.lanes[o.id]) op = null }
    else if (o.op === 'clip.del') { if (!cur.clips[o.id]) op = null }
    else if (o.op === 'notes') {
      const c = cur.clips[o.clip]
      if (!c) { op = null; dropped++ } else {
        // A note of mine that someone changed is theirs now: it is not taken out, and what it replaced stays out.
        const have = [...(c.notes ?? [])], add = [...o.add], del: Note[] = []
        let k = 0
        for (const d of o.del) {
          const i = have.findIndex((n) => sameNote(n, d))
          if (i >= 0) { have.splice(i, 1); del.push(d); k++ } else { if (k < add.length) add.splice(k, 1); dropped++ }
        }
        op = add.length || del.length ? { ...o, add, del } : null
      }
    } else if (o.op === 'auto') {
      const l = cur.lanes[o.lane]
      if (!l) { op = null; dropped++ } else {
        const have = [...(l.automation?.[o.param] ?? [])], paired = o.add.length === o.del.length, add = [...o.add], del: Point[] = []
        let k = 0
        for (const d of o.del) {
          const i = have.findIndex((p) => samePoint(p, d))
          if (i >= 0) { have.splice(i, 1); del.push(d); k++ } else { if (paired) add.splice(k, 1); dropped++ }
        }
        op = add.length || del.length ? { ...o, add, del } : null
      }
    } else if (o.op === 'fx.put') {
      const key = `fx:${o.lane ?? ''}:${o.effect.id}`
      const list = o.lane ? cur.lanes[o.lane]?.effects : cur.project.master_effects ?? []
      const e = list?.find((x) => x.id === o.effect.id)
      if (!list || (!e && !(o.effect.type && gone.has(key)))) { op = null; dropped++ }
      else if (e && !o.effect.type) {
        const mine = left.get(key) ?? {}
        const params = Object.fromEntries(Object.entries(o.effect.params ?? {}).filter(([p]) => { const ok = !(`p:${p}` in mine) || same(e.params?.[p], mine[`p:${p}`]); if (!ok) dropped++; return ok }))
        const on = o.effect.on !== undefined && (!('on' in mine) || e.on === mine.on)
        if (o.effect.on !== undefined && !on) dropped++
        const effect = { id: e.id, ...(on ? { on: o.effect.on } : {}), ...(Object.keys(params).length ? { params } : {}) }
        op = Object.keys(effect).length > 1 || o.at !== undefined ? { ...o, effect } : null
      }
    } else if (o.op === 'marker.put') {
      const m = (cur.project.markers ?? []).find((x) => x.id === o.marker.id)
      if (m) { const marker = still(`marker:${m.id}`, m, o.marker); op = marker ? { op: 'marker.put', marker } : null }
      else if (!gone.has(`marker:${o.marker.id}`)) { op = null; dropped++ }
    }
    if (!op) continue
    out.push(op)
    cur = applyOps(cur, [op], '')
  }
  return { ops: out, dropped }
}

/** A put of mine as the server stored it (`applied`: what it answered for that op): the same fields, its values. */
export function storedAs(o: Op, applied: Applied | undefined): Op | null {
  if (!applied || applied.op !== o.op) return null
  const pick = (from: object, keys: string[]) => Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, (from as Record<string, unknown>)[k]]))
  if (o.op === 'lane.put' && applied.op === 'lane.put') return { op: 'lane.put', lane: { ...pick(applied.lane, Object.keys(o.lane)), id: o.lane.id } }
  if (o.op === 'clip.put' && applied.op === 'clip.put') return { op: 'clip.put', clip: { ...pick(applied.clip, Object.keys(o.clip)), id: o.clip.id } }
  if (o.op === 'project' && applied.op === 'project' && !o.clear_loop) return { ...pick(applied.project, Object.keys(o).filter((k) => k !== 'op')), op: 'project' }
  return null
}

/** Audible lanes: not muted, and soloed when anything is. Buses stay audible under solo (they carry the solo). */
export function audible(lanes: Record<string, StudioLane>, id: string) {
  const l = lanes[id]
  if (!l || l.mute) return false
  if (l.kind === 'bus') return true
  return !Object.values(lanes).some((x) => x.solo && x.kind !== 'bus') || l.solo
}

export type Point = [number, number]

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

/** The longest crossfade made where clips on one track overlap (ms). */
export const SEAM_MS = 10

/**
 * Where audio clips on one track overlap, the one that starts later is heard (of two starting together, the one
 * with the later id) and the other is silent under it, with a short crossfade at each edge. For every clip that is
 * affected: its level over time as points [timeline ms, 0..1], to multiply with its own gain and fades. Clips that
 * overlap nothing are not in the map.
 */
export function seams(clips: Record<string, StudioClip>): Map<string, Point[]> {
  const by = new Map<string, StudioClip[]>()
  for (const c of Object.values(clips)) if (!c.muted && c.audio_id && !c.notes) { const l = by.get(c.lane_id); if (l) l.push(c); else by.set(c.lane_id, [c]) }
  const out = new Map<string, Point[]>()
  for (const list of by.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.start_ms - b.start_ms || (a.id < b.id ? -1 : 1))
    for (let i = 0; i < list.length; i++) {
      const c = list[i], end = c.start_ms + c.length_ms
      const pts: Point[] = []
      // An earlier clip still sounding where this one starts or ends: fade in over it, and out to it.
      let before = 0, after = 0
      for (let j = 0; j < i; j++) { const e = list[j].start_ms + list[j].length_ms; if (e > c.start_ms) { before = Math.max(before, Math.min(e, end) - c.start_ms); if (e > end) after = Math.max(after, end - c.start_ms) } }
      if (before > 0) { const x = Math.min(SEAM_MS, before / 2); pts.push([c.start_ms, 0], [c.start_ms + x, 1]) }
      // Later clips over this one, their ranges joined where they touch.
      let s = -1, e = -1
      const cover = (a: number, b: number) => { const x = Math.min(SEAM_MS, (b - a) / 2); pts.push([a, 1], [a + x, 0]); if (b < end) pts.push([b - x, 0], [b, 1]) }
      for (let j = i + 1; j < list.length; j++) {
        const d = list[j]
        if (d.start_ms >= end) break
        const de = Math.min(end, d.start_ms + d.length_ms)
        if (s < 0) { s = d.start_ms; e = de } else if (d.start_ms <= e) e = Math.max(e, de)
        else { cover(s, e); s = d.start_ms; e = de }
      }
      if (s >= 0) cover(s, e)
      if (after > 0 && (s < 0 || e < end)) { const x = Math.min(SEAM_MS, after / 2); pts.push([end - x, 1], [end, 0]) }
      if (pts.length) out.set(c.id, pts.sort((a, b) => a[0] - b[0]))
    }
  }
  return out
}
