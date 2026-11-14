import type { StudioClip, StudioLane, StudioProject } from './types'

/**
 * The DAW's project arithmetic, with no store, network or audio in it: what an edit (ops) does to a project, the ops
 * that undo it, and the small questions asked of lanes and clips (order, length, what is audible, an automation
 * lane's value). `daw.ts` runs these against the open project.
 */

export type Op =
  | ({ op: 'project'; /** Drop the loop range (and loop / punch with it). */ clear_loop?: boolean } & Partial<Pick<StudioProject, 'name' | 'bpm' | 'beats' | 'master_gain' | 'master_effects' | 'tempo_map' | 'loop_on' | 'loop_start_ms' | 'loop_end_ms' | 'punch_on' | 'markers'>>)
  | { op: 'lane.put'; lane: Partial<StudioLane> & { id: string } }
  | { op: 'lane.del'; id: string }
  | { op: 'clip.put'; clip: Partial<StudioClip> & { id: string } }
  | { op: 'clip.del'; id: string }
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
  }
  delete (project as Partial<StudioProject> & { op?: unknown }).op
  return { project, lanes, clips }
}

/** The ops that undo `ops`, from the project as it is before them. */
export function inverseOps({ project, lanes, clips }: { project: StudioProject | null; lanes: Record<string, StudioLane>; clips: Record<string, StudioClip> }, ops: Op[]): Op[] {
  const out: Op[] = []
  const pick = <T extends object>(from: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (from as Record<string, unknown>)[k]]))
  for (const o of ops) {
    if (o.op === 'project' && project) out.unshift({ op: 'project', ...pick(project, o.clear_loop ? ['loop_start_ms', 'loop_end_ms', 'loop_on', 'punch_on'] : Object.keys(o).filter((k) => k !== 'op')) })
    else if (o.op === 'lane.put') out.unshift(lanes[o.lane.id] ? { op: 'lane.put', lane: { id: o.lane.id, ...pick(lanes[o.lane.id], Object.keys(o.lane)) } } : { op: 'lane.del', id: o.lane.id })
    else if (o.op === 'lane.del' && lanes[o.id]) out.unshift({ op: 'lane.put', lane: { ...lanes[o.id] } }, ...Object.values(clips).filter((c) => c.lane_id === o.id).map((c): Op => ({ op: 'clip.put', clip: { ...c } })))
    else if (o.op === 'clip.put') out.unshift(clips[o.clip.id] ? { op: 'clip.put', clip: { id: o.clip.id, ...pick(clips[o.clip.id], Object.keys(o.clip)) } } : { op: 'clip.del', id: o.clip.id })
    else if (o.op === 'clip.del' && clips[o.id]) out.unshift({ op: 'clip.put', clip: { ...clips[o.id] } })
  }
  return out
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
