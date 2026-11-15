import { clipEnd } from './dawops'
import type { StudioClip, StudioLane, StudioProject } from './types'

/**
 * Placing things against one another on the timeline: the places a clip, a marker or a loop edge being dragged is
 * drawn to (the edges of other clips, the markers, the playhead, the loop, the start of the song), as they are drawn
 * (a track's nudge included).
 */
export type Target = { ms: number; kind: 'clip' | 'marker' | 'playhead' | 'loop' | 'start' }

/** The places to snap to, leaving out the clips in `skip` (the ones being dragged). */
export function targetsOf(project: Pick<StudioProject, 'markers' | 'loop_start_ms' | 'loop_end_ms'>, lanes: Record<string, StudioLane>, clips: Record<string, StudioClip>, skip: ReadonlySet<string>, playheadMs: number | null): Target[] {
  const out: Target[] = [{ ms: 0, kind: 'start' }]
  for (const c of Object.values(clips)) {
    if (skip.has(c.id) || !lanes[c.lane_id] || (c.group_id && c.muted)) continue
    const n = lanes[c.lane_id].nudge_ms ?? 0
    out.push({ ms: c.start_ms + n, kind: 'clip' }, { ms: clipEnd(c) + n, kind: 'clip' })
  }
  for (const m of project.markers ?? []) out.push({ ms: m.ms, kind: 'marker' })
  if (project.loop_end_ms != null && project.loop_start_ms != null && project.loop_end_ms > project.loop_start_ms) out.push({ ms: project.loop_start_ms, kind: 'loop' }, { ms: project.loop_end_ms, kind: 'loop' })
  if (playheadMs != null) out.push({ ms: playheadMs, kind: 'playhead' })
  return out
}

/**
 * The nearest of `targets` to any of `edges`, within `tol` (ms): how far to move so that edge lands on it, and where
 * that is. Null when none is near enough.
 */
export function magnet(edges: number[], targets: Target[], tol: number): { shift: number; at: number; kind: Target['kind'] } | null {
  let best: { shift: number; at: number; kind: Target['kind'] } | null = null
  for (const e of edges) for (const t of targets) {
    const d = t.ms - e
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, at: t.ms, kind: t.kind }
  }
  return best
}

/** The places the playhead jumps between (clip edges, markers, the loop, the start), in order, each once. */
export function stops(targets: Target[]) {
  return [...new Set(targets.filter((t) => t.kind !== 'playhead').map((t) => Math.round(t.ms)))].sort((a, b) => a - b)
}
/** The next stop after `ms` (dir 1) or before it (dir −1), or null. */
export function nextStop(list: number[], ms: number, dir: 1 | -1) {
  if (dir > 0) return list.find((x) => x > ms + 0.5) ?? null
  for (let i = list.length - 1; i >= 0; i--) if (list[i] < ms - 0.5) return list[i]
  return null
}

/** Every clip of `sel` onto the grid by its start (`snap` turns a time into the nearest line). */
export function quantized(sel: StudioClip[], snap: (ms: number) => number) {
  return sel.map((c) => ({ id: c.id, start_ms: Math.max(0, Math.round(snap(c.start_ms))) })).filter((x, i) => x.start_ms !== sel[i].start_ms)
}
/** The selection moved as one so that its first clip starts at `ms`. */
export function movedTo(sel: StudioClip[], ms: number) {
  if (!sel.length) return []
  const d = Math.round(ms) - Math.min(...sel.map((c) => c.start_ms))
  return d ? sel.map((c) => ({ id: c.id, start_ms: Math.max(0, c.start_ms + d) })) : []
}
/** Every clip of the selection starting where the earliest one starts. */
export function alignedStarts(sel: StudioClip[]) {
  if (sel.length < 2) return []
  const at = Math.min(...sel.map((c) => c.start_ms))
  return sel.filter((c) => c.start_ms !== at).map((c) => ({ id: c.id, start_ms: at }))
}
