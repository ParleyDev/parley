import { describe, expect, it } from 'vitest'
import { barBeat, bars, beatsAt, isDownbeat, secAtBar, secAtBeat, snapTo, tempoAt } from './tempo'

const flat = { bpm: 120, beats: 4 }
// 120 in 4 for four bars (16 beats, 8 s), then 60 in 3.
const map = { bpm: 120, beats: 4, tempo_map: [{ bar: 4, bpm: 60, beats: 3 }] }

describe('one tempo', () => {
  it('converts seconds and beats both ways', () => {
    expect(beatsAt(flat, 0)).toBe(0)
    expect(beatsAt(flat, 1)).toBe(2)
    expect(secAtBeat(flat, 8)).toBe(4)
    for (const s of [0, 0.3, 1.25, 77.7]) expect(secAtBeat(flat, beatsAt(flat, s))).toBeCloseTo(s, 9)
  })
  it('knows bars and downbeats', () => {
    expect([0, 1, 4, 7, 8].map((n) => isDownbeat(flat, n))).toEqual([true, false, true, false, true])
    expect(secAtBar(flat, 3)).toBe(6)
    expect(barBeat(flat, 0)).toMatchObject({ bar: 1, beat: 1 })
    expect(barBeat(flat, 2.5)).toMatchObject({ bar: 2, beat: 2 })
    expect(bars(flat, 4)).toEqual([{ bar: 0, sec: 0 }, { bar: 1, sec: 2 }, { bar: 2, sec: 4 }])
  })
  it('snaps to the nearest line', () => {
    expect(snapTo(flat, 1234, 'off')).toBe(1234)
    expect(snapTo(flat, 1234, 'bar')).toBe(2000)
    expect(snapTo(flat, 900, 'bar')).toBe(0)
    expect(snapTo(flat, 1234, 'beat')).toBe(1000)
    expect(snapTo(flat, 1300, 'half')).toBe(1250)
    expect(snapTo(flat, 1300, 'sixteenth')).toBe(1250)
    expect(snapTo(flat, 1320, 'sixteenth')).toBe(1375)
  })
})

describe('a tempo change', () => {
  it('starts at its bar', () => {
    expect(secAtBar(map, 4)).toBe(8)
    expect(secAtBar(map, 5)).toBe(11)
    expect(tempoAt(map, 7.99)).toEqual({ bpm: 120, beats: 4 })
    expect(tempoAt(map, 8)).toEqual({ bpm: 60, beats: 3 })
  })
  it('counts beats through it', () => {
    expect(beatsAt(map, 8)).toBe(16)
    expect(beatsAt(map, 10)).toBe(18)
    expect(secAtBeat(map, 19)).toBe(11)
    for (const s of [0, 3.3, 8, 9.5, 40]) expect(secAtBeat(map, beatsAt(map, s))).toBeCloseTo(s, 9)
    expect([16, 17, 18, 19, 22].map((n) => isDownbeat(map, n))).toEqual([true, false, false, true, true])
    expect(barBeat(map, 12.5)).toMatchObject({ bar: 6, beat: 2, bpm: 60, beats: 3 })
  })
  it('snaps on its own grid', () => {
    expect(snapTo(map, 9400, 'beat')).toBe(9000)
    expect(snapTo(map, 9800, 'bar')).toBe(11000)
    expect(snapTo(map, 7900, 'bar')).toBe(8000)
  })
  it('ignores changes at bar 0 and lets a later one at the same bar win', () => {
    expect(tempoAt({ bpm: 100, beats: 4, tempo_map: [{ bar: 0, bpm: 50, beats: 3 }] }, 0)).toEqual({ bpm: 100, beats: 4 })
    expect(tempoAt({ bpm: 100, beats: 4, tempo_map: [{ bar: 2, bpm: 50, beats: 3 }, { bar: 2, bpm: 70, beats: 5 }] }, 100)).toEqual({ bpm: 70, beats: 5 })
  })
})
