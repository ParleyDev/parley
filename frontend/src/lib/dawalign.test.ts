import { describe, expect, it } from 'vitest'
import { alignedStarts, magnet, movedTo, nextStop, quantized, stops, targetsOf } from './dawalign'
import type { StudioClip, StudioLane, StudioProject } from './types'

const lane = (id: string, over: Partial<StudioLane> = {}) => ({ id, project_id: 'p', name: id, color: null, position: 0, gain: 1, pan: 0, mute: false, solo: false, user_id: null, kind: 'audio', effects: [], sends: {}, ...over }) as StudioLane
const clip = (id: string, lane_id: string, over: Partial<StudioClip> = {}) => ({ id, project_id: 'p', lane_id, audio_id: 'a', start_ms: 0, in_ms: 0, length_ms: 1000, gain: 1, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: null, ...over }) as StudioClip
const project = { markers: [{ id: 'm', ms: 7000, name: 'Chorus' }], loop_start_ms: 2000, loop_end_ms: 6000 } as Pick<StudioProject, 'markers' | 'loop_start_ms' | 'loop_end_ms'>
const lanes = { l1: lane('l1'), l2: lane('l2', { nudge_ms: 30 }) }
const clips = {
  a: clip('a', 'l1', { start_ms: 1000, length_ms: 1500 }),
  b: clip('b', 'l2', { start_ms: 3000, length_ms: 500 }),
  // A take that is not heard is not a place to snap to.
  t: clip('t', 'l1', { start_ms: 4321, group_id: 'g', muted: true }),
}

describe('places to snap to', () => {
  it('are other clips’ edges as drawn, markers, the loop, the playhead and the start', () => {
    const t = targetsOf(project, lanes, clips, new Set(['a']), 5000)
    expect(t.map((x) => [x.ms, x.kind])).toEqual([[0, 'start'], [3030, 'clip'], [3530, 'clip'], [7000, 'marker'], [2000, 'loop'], [6000, 'loop'], [5000, 'playhead']])
  })
  it('draw the nearest edge within reach, and none beyond it', () => {
    const t = targetsOf(project, lanes, clips, new Set(), null)
    // The end of a dragged clip at 2990 is 40 ms from b's start (3030); its start at 1990 is 10 ms from the loop.
    expect(magnet([1990, 2990], t, 50)).toEqual({ shift: 10, at: 2000, kind: 'loop' })
    expect(magnet([3020], t, 50)).toEqual({ shift: 10, at: 3030, kind: 'clip' })
    expect(magnet([4700], t, 50)).toBe(null)
  })
  it('are where the playhead jumps, in order', () => {
    const list = stops(targetsOf(project, lanes, clips, new Set(), 5000))
    expect(list).toEqual([0, 1000, 2000, 2500, 3030, 3530, 6000, 7000])
    expect(nextStop(list, 2500, 1)).toBe(3030)
    expect(nextStop(list, 2500, -1)).toBe(2000)
    expect(nextStop(list, 7000, 1)).toBe(null)
    expect(nextStop(list, 0, -1)).toBe(null)
  })
})

describe('aligning a selection', () => {
  const sel = [clip('x', 'l1', { start_ms: 1030 }), clip('y', 'l2', { start_ms: 1490 }), clip('z', 'l1', { start_ms: 2000 })]
  it('puts each clip on the grid by its start, leaving those already there', () => {
    expect(quantized(sel, (ms) => Math.round(ms / 500) * 500)).toEqual([{ id: 'x', start_ms: 1000 }, { id: 'y', start_ms: 1500 }])
  })
  it('moves the selection as one to a place', () => {
    expect(movedTo(sel, 4000)).toEqual([{ id: 'x', start_ms: 4000 }, { id: 'y', start_ms: 4460 }, { id: 'z', start_ms: 4970 }])
    expect(movedTo(sel, 1030)).toEqual([])
  })
  it('starts every clip with the earliest', () => {
    expect(alignedStarts(sel)).toEqual([{ id: 'y', start_ms: 1030 }, { id: 'z', start_ms: 1030 }])
    expect(alignedStarts(sel.slice(0, 1))).toEqual([])
  })
})
