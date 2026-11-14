import { describe, expect, it } from 'vitest'
import { applyOps, audible, clipEnd, inverseOps, projectEnd, seams, SEAM_MS, sortedLanes, valueAt, type Doc, type Op } from './dawops'
import type { StudioClip, StudioLane, StudioProject } from './types'

const project = { id: 'p', channel_id: 'c', name: 'Song', bpm: 120, beats: 4, master_gain: 1, created_by: null, created_at: '', updated_at: '', version: 1, master_effects: [], loop_on: true, loop_start_ms: 1000, loop_end_ms: 5000, punch_on: true } as StudioProject
const lane = (id: string, over: Partial<StudioLane> = {}) => ({ id, project_id: 'p', name: id, color: null, position: 0, gain: 1, pan: 0, mute: false, solo: false, user_id: null, kind: 'audio', effects: [], sends: {}, ...over }) as StudioLane
const clip = (id: string, lane_id: string, over: Partial<StudioClip> = {}) => ({ id, project_id: 'p', lane_id, audio_id: 'a', start_ms: 0, in_ms: 0, length_ms: 1000, gain: 1, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: null, ...over }) as StudioClip
const doc = (): Doc => ({ project, lanes: { l1: lane('l1'), l2: lane('l2', { position: 1 }) }, clips: { c1: clip('c1', 'l1'), c2: clip('c2', 'l1', { start_ms: 2000 }), c3: clip('c3', 'l2', { start_ms: 500, length_ms: 4000 }) } })
const run = (d: Doc, ops: Op[]) => applyOps(d, ops, 'Track')

describe('ops', () => {
  it('change what they name and leave the rest', () => {
    const d = doc(), out = run(d, [{ op: 'clip.put', clip: { id: 'c1', start_ms: 300 } }, { op: 'lane.put', lane: { id: 'l2', gain: 0.5 } }, { op: 'project', bpm: 90 }])
    expect(out.clips.c1).toEqual({ ...d.clips.c1, start_ms: 300 })
    expect(out.lanes.l2).toEqual({ ...d.lanes.l2, gain: 0.5 })
    expect(out.project).toEqual({ ...project, bpm: 90 })
    expect(out.clips.c2).toBe(d.clips.c2)
    // The project given is not touched.
    expect(d).toEqual(doc())
  })
  it('make new lanes and clips with defaults', () => {
    const out = run(doc(), [{ op: 'lane.put', lane: { id: 'l3', position: 2 } }, { op: 'clip.put', clip: { id: 'c9', lane_id: 'l3', audio_id: 'a', length_ms: 700 } }])
    expect(out.lanes.l3).toMatchObject({ project_id: 'p', name: 'Track', gain: 1, pan: 0, mute: false, solo: false, position: 2 })
    expect(out.clips.c9).toMatchObject({ project_id: 'p', start_ms: 0, in_ms: 0, gain: 1, fade_in_ms: 0, fade_out_ms: 0, muted: false, length_ms: 700 })
  })
  it('take a lane\'s clips with it', () => {
    const out = run(doc(), [{ op: 'lane.del', id: 'l1' }])
    expect(Object.keys(out.lanes)).toEqual(['l2'])
    expect(Object.keys(out.clips)).toEqual(['c3'])
  })
  it('clear the loop', () => {
    expect(run(doc(), [{ op: 'project', clear_loop: true }]).project).toMatchObject({ loop_on: false, punch_on: false, loop_start_ms: null, loop_end_ms: null })
  })
  it('apply what the server broadcasts', () => {
    const out = applyOps(doc(), [{ op: 'project', project: { name: 'Renamed', version: 2 } }, { op: 'clip.put', clip: clip('c1', 'l2', { start_ms: 42 }) }], 'Track')
    expect(out.project).toEqual({ ...project, name: 'Renamed', version: 2 })
    expect(out.clips.c1).toEqual(clip('c1', 'l2', { start_ms: 42 }))
  })
})

describe('undo', () => {
  const edits: Record<string, Op[]> = {
    'a move': [{ op: 'clip.put', clip: { id: 'c1', start_ms: 300, lane_id: 'l2' } }],
    'a new clip': [{ op: 'clip.put', clip: { id: 'c9', lane_id: 'l1', audio_id: 'a', length_ms: 700 } }],
    'a deleted clip': [{ op: 'clip.del', id: 'c2' }],
    'a split': [{ op: 'clip.put', clip: { id: 'c3', length_ms: 1500 } }, { op: 'clip.put', clip: { id: 'c8', lane_id: 'l2', audio_id: 'a', start_ms: 2000, in_ms: 1500, length_ms: 2500 } }],
    'a deleted lane with its clips': [{ op: 'lane.del', id: 'l1' }],
    'a new lane': [{ op: 'lane.put', lane: { id: 'l3', position: 2 } }],
    'mixer moves': [{ op: 'lane.put', lane: { id: 'l1', gain: 0.25, pan: -1, mute: true } }],
    'project settings': [{ op: 'project', bpm: 90, master_gain: 0.5 }],
    'a cleared loop': [{ op: 'project', clear_loop: true }],
    'the same clip twice': [{ op: 'clip.put', clip: { id: 'c1', start_ms: 300 } }, { op: 'clip.put', clip: { id: 'c1', start_ms: 900 } }],
    'a clip made then deleted': [{ op: 'clip.put', clip: { id: 'c9', lane_id: 'l1', audio_id: 'a', length_ms: 700 } }, { op: 'clip.del', id: 'c9' }],
  }
  // Each op is undone from the project as it stood before that op, as the editor does for a batch.
  const invert = (d: Doc, ops: Op[]) => inverseOps(d, ops)
  for (const [name, ops] of Object.entries(edits)) {
    it(`puts back ${name}`, () => {
      const before = doc(), undo = invert(before, ops), after = run(before, ops)
      expect(run(after, undo)).toEqual(before)
    })
    it(`redoes ${name}`, () => {
      const before = doc(), after = run(before, ops), back = run(after, invert(before, ops))
      expect(run(back, ops)).toEqual(after)
    })
  }
  it('of something that is not there is nothing', () => {
    expect(inverseOps(doc(), [{ op: 'clip.del', id: 'nope' }, { op: 'lane.del', id: 'nope' }])).toEqual([])
    expect(inverseOps({ project: null, lanes: {}, clips: {} }, [{ op: 'project', bpm: 90 }])).toEqual([])
  })
})

describe('lanes and clips', () => {
  it('sort by position, then id', () => {
    expect(sortedLanes({ b: lane('b', { position: 1 }), c: lane('c'), a: lane('a', { position: 1 }) }).map((l) => l.id)).toEqual(['c', 'a', 'b'])
  })
  it('measure the project by its last clip', () => {
    expect(clipEnd(clip('x', 'l1', { start_ms: 250, length_ms: 1000 }))).toBe(1250)
    expect(projectEnd(doc().clips)).toBe(4500)
    expect(projectEnd({})).toBe(0)
  })
  it('are audible unless muted, or unsoloed while another is soloed', () => {
    const ls = { a: lane('a'), b: lane('b', { mute: true }), bus: lane('bus', { kind: 'bus' }) }
    expect(['a', 'b', 'bus', 'gone'].map((id) => audible(ls, id))).toEqual([true, false, true, false])
    const solo = { ...ls, c: lane('c', { solo: true }), d: lane('d', { solo: true, mute: true }) }
    expect(['a', 'b', 'c', 'd', 'bus'].map((id) => audible(solo, id))).toEqual([false, false, true, false, true])
    // A soloed bus silences nothing.
    expect(audible({ a: lane('a'), bus: lane('bus', { kind: 'bus', solo: true }) }, 'a')).toBe(true)
  })
})

describe('automation', () => {
  it('interpolates between points and holds outside them', () => {
    const pts: [number, number][] = [[1000, 0], [2000, 1], [4000, 0.5]]
    expect([0, 1000, 1500, 2000, 3000, 4000, 9000].map((ms) => valueAt(pts, ms))).toEqual([0, 0, 0.5, 1, 0.75, 0.5, 0.5])
    expect(valueAt([], 100)).toBe(0)
    expect(valueAt([[500, 0.3]], 0)).toBe(0.3)
  })
  it('jumps at two points on the same instant', () => {
    const pts: [number, number][] = [[0, 0], [1000, 0.2], [1000, 0.8], [2000, 0.8]]
    expect(valueAt(pts, 999)).toBeCloseTo(0.1998, 4)
    expect(valueAt(pts, 1000)).toBe(0.2)
    expect(valueAt(pts, 1001)).toBe(0.8)
  })
})

describe('overlapping clips', () => {
  const level = (m: Map<string, [number, number][]>, id: string, ms: number) => (m.has(id) ? valueAt(m.get(id)!, ms) : 1)
  it('leave clips that overlap nothing alone', () => {
    const m = seams({ a: clip('a', 'l1'), b: clip('b', 'l1', { start_ms: 1000 }), c: clip('c', 'l2', { start_ms: 500 }) })
    expect(m.size).toBe(0)
  })
  it('the later clip is heard, with a short crossfade where it starts', () => {
    const m = seams({ a: clip('a', 'l1', { length_ms: 2000 }), b: clip('b', 'l1', { start_ms: 1000, length_ms: 2000 }) })
    expect(level(m, 'a', 500)).toBe(1)
    expect(level(m, 'a', 1000)).toBe(1)
    expect(level(m, 'a', 1000 + SEAM_MS)).toBe(0)
    expect(level(m, 'a', 1900)).toBe(0)
    expect(level(m, 'b', 1000)).toBe(0)
    expect(level(m, 'b', 1000 + SEAM_MS)).toBe(1)
    expect(level(m, 'b', 2500)).toBe(1)
    // Through the seam the two add up to one.
    for (let ms = 1000; ms <= 1000 + SEAM_MS; ms++) expect(level(m, 'a', ms) + level(m, 'b', ms)).toBeCloseTo(1, 9)
  })
  it('a clip inside another cuts a hole in it and gives way at its end', () => {
    const m = seams({ a: clip('a', 'l1', { length_ms: 3000 }), b: clip('b', 'l1', { start_ms: 1000, length_ms: 1000 }) })
    expect([500, 1500, 2500].map((ms) => level(m, 'a', ms))).toEqual([1, 0, 1])
    expect([1000, 1500, 2000].map((ms) => level(m, 'b', ms))).toEqual([0, 1, 0])
    for (let ms = 990; ms <= 2010; ms++) expect(level(m, 'a', ms) + level(m, 'b', ms)).toBeCloseTo(1, 9)
  })
  it('of two that start together the one with the later id is heard', () => {
    const m = seams({ a: clip('a', 'l1'), b: clip('b', 'l1') })
    expect(level(m, 'a', 500)).toBe(0)
    expect(level(m, 'b', 500)).toBe(1)
  })
  it('muted clips, notes and other tracks do not count', () => {
    const m = seams({ a: clip('a', 'l1', { length_ms: 2000 }), b: clip('b', 'l1', { start_ms: 500, muted: true }), c: clip('c', 'l2', { start_ms: 500 }), d: clip('d', 'l1', { start_ms: 500, audio_id: null, notes: [] }) })
    expect(m.size).toBe(0)
  })
  it('a very short overlap is crossed in half its length each way', () => {
    const m = seams({ a: clip('a', 'l1', { length_ms: 1004 }), b: clip('b', 'l1', { start_ms: 1000 }) })
    expect(level(m, 'a', 1002)).toBe(0)
    expect(level(m, 'b', 1002)).toBe(1)
    expect(level(m, 'a', 1001) + level(m, 'b', 1001)).toBeCloseTo(1, 9)
  })
})
