import { describe, expect, it } from 'vitest'
import { applyOps, audible, clipEnd, inverseOps, itemize, projectEnd, same, seams, SEAM_MS, settle, sortedLanes, storedAs, valueAt, type Doc, type Op } from './dawops'
import type { Effect } from './fx'
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

const fx = (id: string, over: Partial<Effect> = {}) => ({ id, type: 'eq', on: true, params: { lowcut: 20, high: 0 }, ...over }) as Effect
const n = (p: number, t: number) => ({ p, t, d: 100, v: 100 })
/** A project with lists in it: a note clip, an automated lane with effects, master effects and markers. */
const lists = (): Doc => {
  const d = doc()
  return {
    project: { ...project, master_effects: [fx('m1'), fx('m2', { type: 'limiter', params: { ceiling: -1 } })], markers: [{ id: 'a', ms: 100, name: 'A' }, { id: 'b', ms: 900, name: 'B' }] },
    lanes: { ...d.lanes, l1: lane('l1', { effects: [fx('e1'), fx('e2'), fx('e3')], automation: { gain: [[0, 1], [500, 0.5]], pan: [[0, 0]] } }) },
    clips: { ...d.clips, m: clip('m', 'l2', { audio_id: null, notes: [n(60, 0), n(64, 100), n(67, 200)] }) },
  }
}
/** What is sent for an edit, and the project after it. */
const sent = (d: Doc, ops: Op[]) => { const wire = itemize(d, ops); return { wire, out: run(d, wire) } }

describe('edits to a list are sent by item', () => {
  it('notes: what was added and what was taken out', () => {
    const d = lists(), notes = [n(60, 0), n(67, 200), n(72, 300)]
    const { wire, out } = sent(d, [{ op: 'clip.put', clip: { id: 'm', notes } }])
    expect(wire).toEqual([{ op: 'notes', clip: 'm', add: [n(72, 300)], del: [n(64, 100)] }])
    expect(out.clips.m.notes).toEqual([n(60, 0), n(72, 300), n(67, 200)])
  })
  it('a clip\'s other fields go as fields, and an unchanged list is not sent', () => {
    const d = lists()
    expect(itemize(d, [{ op: 'clip.put', clip: { id: 'm', start_ms: 40, notes: d.clips.m.notes } }])).toEqual([{ op: 'clip.put', clip: { id: 'm', start_ms: 40 } }])
    expect(itemize(d, [{ op: 'clip.put', clip: { id: 'm', notes: [...d.clips.m.notes!] } }])).toEqual([])
  })
  it('a new clip, and a clip that had no notes, keep their list whole', () => {
    const d = lists(), a: Op = { op: 'clip.put', clip: { id: 'new', lane_id: 'l2', notes: [n(60, 0)] } }, b: Op = { op: 'clip.put', clip: { id: 'c1', notes: [n(60, 0)] } }
    expect(itemize(d, [a, b])).toEqual([a, b])
  })
  it('automation: per parameter, the points that differ', () => {
    const d = lists()
    const { wire, out } = sent(d, [{ op: 'lane.put', lane: { id: 'l1', automation: { gain: [[0, 1], [250, 0.8], [500, 0.5]] } } }])
    expect(wire).toEqual([{ op: 'auto', lane: 'l1', param: 'gain', add: [[250, 0.8]], del: [] }, { op: 'auto', lane: 'l1', param: 'pan', add: [], del: [[0, 0]] }])
    expect(out.lanes.l1.automation).toEqual({ gain: [[0, 1], [250, 0.8], [500, 0.5]] })
  })
  it('automation: a step whose order merging would lose replaces its parameter', () => {
    const d = lists(), gain: [number, number][] = [[0, 1], [500, 0.9], [500, 0.5]]
    const { wire, out } = sent(d, [{ op: 'lane.put', lane: { id: 'l1', automation: { gain, pan: [[0, 0]] } } }])
    expect(wire).toEqual([{ op: 'auto', lane: 'l1', param: 'gain', add: gain, del: [[0, 1], [500, 0.5]] }])
    expect(out.lanes.l1.automation.gain).toEqual(gain)
  })
  it('effects: a parameter, a switch, a new one, one removed, a new order', () => {
    const d = lists(), [e1, e2, e3] = d.lanes.l1.effects
    const turn = (next: Effect[]) => sent(d, [{ op: 'lane.put', lane: { id: 'l1', effects: next } }])
    expect(turn([e1, { ...e2, params: { ...e2.params, high: 3 } }, e3]).wire).toEqual([{ op: 'fx.put', lane: 'l1', effect: { id: 'e2', params: { high: 3 } } }])
    expect(turn([{ ...e1, on: false }, e2, e3]).wire).toEqual([{ op: 'fx.put', lane: 'l1', effect: { id: 'e1', on: false } }])
    expect(turn([e1, e3]).wire).toEqual([{ op: 'fx.del', lane: 'l1', id: 'e2' }])
    const added = turn([e1, fx('e9'), e2, e3])
    expect(added.wire).toEqual([{ op: 'fx.put', lane: 'l1', effect: fx('e9'), at: 1 }])
    expect(added.out.lanes.l1.effects.map((e) => e.id)).toEqual(['e1', 'e9', 'e2', 'e3'])
    const moved = turn([e3, e1, e2])
    expect(moved.wire).toEqual([{ op: 'fx.put', lane: 'l1', effect: { id: 'e3' }, at: 0 }])
    expect(moved.out.lanes.l1.effects).toEqual([e3, e1, e2])
    // Everything at once still comes out as asked.
    const next = [fx('e9'), { ...e3, on: false }, { ...e1, params: { lowcut: 80, high: 0 } }]
    expect(turn(next).out.lanes.l1.effects).toEqual(next)
  })
  it('effects: another kind under the same id, or a parameter gone, is not said by item', () => {
    const d = lists(), [e1, e2, e3] = d.lanes.l1.effects
    const swapped = [{ ...e1, type: 'limiter', params: { ceiling: -1 } } as Effect, e2, e3]
    expect(run(d, itemize(d, [{ op: 'lane.put', lane: { id: 'l1', effects: swapped } }])).lanes.l1.effects).toEqual(swapped)
    const fewer = [{ ...e1, params: { lowcut: 20 } }, e2, e3]
    expect(itemize(d, [{ op: 'lane.put', lane: { id: 'l1', effects: fewer } }])).toEqual([{ op: 'lane.put', lane: { id: 'l1', effects: fewer } }])
  })
  it('the master effects and the markers', () => {
    const d = lists(), [m1, m2] = d.project.master_effects
    const { wire, out } = sent(d, [{ op: 'project', bpm: 100, master_effects: [m2, m1], markers: [{ id: 'a', ms: 150, name: 'A' }, { id: 'c', ms: 50, name: 'C' }] }])
    expect(wire).toEqual([{ op: 'project', bpm: 100 }, { op: 'fx.put', effect: { id: 'm2' }, at: 0 }, { op: 'marker.del', id: 'b' }, { op: 'marker.put', marker: { id: 'a', ms: 150 } }, { op: 'marker.put', marker: { id: 'c', ms: 50, name: 'C' } }])
    expect(out.project).toMatchObject({ bpm: 100, master_effects: [m2, m1], markers: [{ id: 'a', ms: 150, name: 'A' }, { id: 'c', ms: 50, name: 'C' }] })
  })
  it('two people adding to one list both keep theirs', () => {
    const d = lists()
    const mine = itemize(d, [{ op: 'clip.put', clip: { id: 'm', notes: [...d.clips.m.notes!, n(72, 300)] } }, { op: 'lane.put', lane: { id: 'l1', automation: { ...d.lanes.l1.automation, gain: [...d.lanes.l1.automation.gain, [800, 0.2]] } } }])
    const theirs = itemize(d, [{ op: 'clip.put', clip: { id: 'm', notes: [...d.clips.m.notes!, n(48, 0)] } }, { op: 'lane.put', lane: { id: 'l1', automation: { ...d.lanes.l1.automation, gain: [[250, 0.7], ...d.lanes.l1.automation.gain] } } }])
    const out = run(run(d, theirs), mine)
    expect(out.clips.m.notes).toEqual([...d.clips.m.notes!, n(48, 0), n(72, 300)])
    expect(out.lanes.l1.automation.gain).toEqual([[0, 1], [250, 0.7], [500, 0.5], [800, 0.2]])
  })
  it('an effect or marker someone removed is not brought back by a change to it', () => {
    const d = lists()
    const mine = itemize(d, [{ op: 'lane.put', lane: { id: 'l1', effects: d.lanes.l1.effects.map((e) => (e.id === 'e2' ? { ...e, on: false } : e)) } }, { op: 'project', markers: d.project.markers!.map((m) => (m.id === 'b' ? { ...m, ms: 5 } : m)) }])
    const out = run(run(d, [{ op: 'fx.del', lane: 'l1', id: 'e2' }, { op: 'marker.del', id: 'b' }]), mine)
    expect(out.lanes.l1.effects.map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(out.project.markers).toEqual([{ id: 'a', ms: 100, name: 'A' }])
  })
})

describe('item edits are undone', () => {
  const edits: [string, Op[]][] = [
    ['notes', [{ op: 'clip.put', clip: { id: 'm', length_ms: 900, notes: [n(60, 0), n(65, 100), n(72, 300)] } }]],
    ['automation', [{ op: 'lane.put', lane: { id: 'l1', gain: 0.3, automation: { gain: [[0, 1], [250, 0.8]], 'send:l2': [[0, 0.4]] } } }]],
    ['effects', [{ op: 'lane.put', lane: { id: 'l1', effects: [fx('e9'), fx('e3', { on: false }), fx('e1', { params: { lowcut: 80, high: 0 } })] } }]],
    ['master effects and markers', [{ op: 'project', master_effects: [fx('m2', { type: 'limiter', params: { ceiling: -3 } })], markers: [{ id: 'b', ms: 10, name: 'Bee' }, { id: 'z', ms: 20, name: 'Z' }] }]],
    ['several at once', [{ op: 'lane.put', lane: { id: 'l1', effects: [fx('e2')] } }, { op: 'lane.put', lane: { id: 'l1', effects: [fx('e2', { on: false }), fx('e7')] } }, { op: 'clip.del', id: 'm' }]],
  ]
  for (const [name, ops] of edits) it(name, () => {
    const d = lists(), wire = itemize(d, ops), after = run(d, wire)
    expect(after).not.toEqual(d)
    const back = run(after, inverseOps(d, wire))
    // Markers are in no order.
    const byMarker = (p: StudioProject) => ({ ...p, markers: [...(p.markers ?? [])].sort((x, y) => x.id.localeCompare(y.id)) })
    expect(byMarker(back.project)).toEqual(byMarker(d.project))
    expect(back.lanes).toEqual(d.lanes)
    // Notes come back, in whatever order.
    const sorted = (c: StudioClip) => ({ ...c, notes: c.notes && [...c.notes].sort((a, b) => a.t - b.t || a.p - b.p) })
    expect(Object.values(back.clips).map(sorted)).toEqual(expect.arrayContaining(Object.values(d.clips).map(sorted)))
  })
})

describe('undo leaves what someone else changed since', () => {
  /** My edit, someone's after it, then my undo: what is sent, and what was left. */
  const undone = (mine: Op[], theirs: Op[]) => {
    const d = lists(), wire = itemize(d, mine), undo = inverseOps(d, wire)
    const now = run(run(d, wire), theirs)
    return { d, now, ...settle(now, undo, wire) }
  }
  it('with nothing changed since, the whole undo goes', () => {
    const { d, now, ops, dropped } = undone([{ op: 'clip.put', clip: { id: 'c1', start_ms: 300, gain: 0.5 } }], [{ op: 'clip.put', clip: { id: 'c2', start_ms: 9 } }])
    expect(dropped).toBe(0)
    expect(run(now, ops).clips.c1).toEqual(d.clips.c1)
  })
  it('a field someone set since is theirs; my other fields go back', () => {
    const { now, ops, dropped } = undone([{ op: 'clip.put', clip: { id: 'c1', start_ms: 300, gain: 0.5 } }], [{ op: 'clip.put', clip: { id: 'c1', start_ms: 700 } }])
    expect(dropped).toBe(1)
    expect(ops).toEqual([{ op: 'clip.put', clip: { id: 'c1', gain: 1 } }])
    expect(run(now, ops).clips.c1).toMatchObject({ start_ms: 700, gain: 1 })
  })
  it('the same for a track and for the project', () => {
    const a = undone([{ op: 'lane.put', lane: { id: 'l1', gain: 0.5, pan: 0.2 } }, { op: 'project', bpm: 90, master_gain: 0.5 }], [{ op: 'lane.put', lane: { id: 'l1', pan: -1 } }, { op: 'project', bpm: 140 }])
    expect(a.dropped).toBe(2)
    expect(a.ops).toEqual([{ op: 'project', master_gain: 1 }, { op: 'lane.put', lane: { id: 'l1', gain: 1 } }])
  })
  it('an undo of nothing but their field sends nothing', () => {
    const { ops, dropped } = undone([{ op: 'clip.put', clip: { id: 'c1', start_ms: 300 } }], [{ op: 'clip.put', clip: { id: 'c1', start_ms: 700 } }])
    expect([ops, dropped]).toEqual([[], 1])
  })
  it('a clip or track someone deleted is not edited, and one I deleted comes back', () => {
    expect(undone([{ op: 'clip.put', clip: { id: 'c1', start_ms: 300 } }], [{ op: 'clip.del', id: 'c1' }])).toMatchObject({ ops: [], dropped: 1 })
    const mine = undone([{ op: 'clip.del', id: 'c1' }], [])
    expect(mine.dropped).toBe(0)
    expect(run(mine.now, mine.ops).clips.c1).toEqual(mine.d.clips.c1)
    // ... unless its track went meanwhile.
    expect(undone([{ op: 'clip.del', id: 'c1' }], [{ op: 'lane.del', id: 'l1' }])).toMatchObject({ ops: [], dropped: 1 })
  })
  it('a note of mine someone moved stays where they put it', () => {
    const base = lists().clips.m.notes!
    const { now, ops, dropped } = undone([{ op: 'clip.put', clip: { id: 'm', notes: [...base, n(72, 300), n(74, 400)] } }], [{ op: 'notes', clip: 'm', add: [n(72, 350)], del: [n(72, 300)] }])
    expect(dropped).toBe(1)
    expect(run(now, ops).clips.m.notes).toEqual([...base, n(72, 350)])
  })
  it('a note I changed and someone changed again is not put back as it was', () => {
    const { now, ops, dropped } = undone([{ op: 'clip.put', clip: { id: 'm', notes: [n(60, 0), n(65, 100), n(67, 200)] } }], [{ op: 'notes', clip: 'm', add: [n(66, 100)], del: [n(65, 100)] }])
    expect([ops, dropped]).toEqual([[], 1])
    expect(now.clips.m.notes).toEqual([n(60, 0), n(66, 100), n(67, 200)])
  })
  it('an effect parameter someone set since, and an effect someone removed', () => {
    const e = lists().lanes.l1.effects
    const a = undone([{ op: 'lane.put', lane: { id: 'l1', effects: [{ ...e[0], on: false, params: { lowcut: 90, high: 2 } }, e[1], e[2]] } }], [{ op: 'fx.put', lane: 'l1', effect: { id: 'e1', params: { lowcut: 200 } } }])
    expect(a.dropped).toBe(1)
    expect(a.ops).toEqual([{ op: 'fx.put', lane: 'l1', effect: { id: 'e1', on: true, params: { high: 0 } } }])
    const b = undone([{ op: 'lane.put', lane: { id: 'l1', effects: [{ ...e[0], on: false }, e[1], e[2]] } }], [{ op: 'fx.del', lane: 'l1', id: 'e1' }])
    expect(b).toMatchObject({ ops: [], dropped: 1 })
  })
  it('values are compared as the server stored them', () => {
    const d = lists(), mine: Op[] = [{ op: 'lane.put', lane: { id: 'l1', gain: 0.7, color: '' } }]
    const undo = inverseOps(d, mine)
    // A 32 bit gain, and no colour for '': the same edit, not someone else's.
    const now = run(d, [{ op: 'lane.put', lane: { ...d.lanes.l1, gain: Math.fround(0.7), color: null } }])
    expect(settle(now, undo, mine).dropped).toBe(0)
    // The server clamped what I sent: its value is what my edit left.
    const clamped = run(d, [{ op: 'lane.put', lane: { ...d.lanes.l1, gain: 2 } }]), big: Op = { op: 'lane.put', lane: { id: 'l1', gain: 9 } }
    expect(settle(clamped, inverseOps(d, [big]), [big]).dropped).toBe(1)
    const stored = storedAs(big, { op: 'lane.put', lane: clamped.lanes.l1 })
    expect(stored).toEqual({ op: 'lane.put', lane: { id: 'l1', gain: 2 } })
    expect(settle(clamped, inverseOps(d, [big]), [big], () => stored!).dropped).toBe(0)
  })
  it('same', () => {
    expect(same(0.7, Math.fround(0.7))).toBe(true)
    expect(same(0.7, 0.71)).toBe(false)
    expect(same(null, '')).toBe(true)
    expect(same([1, { a: 2 }], [1, { a: 2, b: undefined }])).toBe(true)
    expect(same([1, 2], [1, 2, 3])).toBe(false)
    expect(same({ a: 1 }, [1])).toBe(false)
  })
})
