import { describe, expect, it } from 'vitest'
import { autoSnap, barBeat, bars, beatsAt, gridLines, gridStep, isDownbeat, parsePos, posText, secAtBar, secAtBeat, snapTo, tempoAt, timeText } from './tempo'

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

describe('the grid and places', () => {
  it('has finer lines: triplets and 32nds', () => {
    expect(snapTo(flat, 1170, 'triplet')).toBeCloseTo(1166.667, 2)
    expect(snapTo(flat, 1070, 'thirtysecond')).toBe(1062.5)
    expect(gridStep(flat, 0, 'bar')).toBe(2000)
    expect(gridStep(flat, 0, 'sixteenth')).toBe(125)
    expect(gridStep(map, 9000, 'beat')).toBe(1000)
  })
  it('makes auto as fine as the zoom shows', () => {
    // 120 BPM: a beat is 0.5 s. At 24 px/s it is 12 px; at 400 px/s an eighth of it is 25 px.
    expect(autoSnap(flat, 0, 10)).toBe('bar')
    expect(autoSnap(flat, 0, 24)).toBe('beat')
    expect(autoSnap(flat, 0, 60)).toBe('half')
    expect(autoSnap(flat, 0, 100)).toBe('sixteenth')
    expect(autoSnap(flat, 0, 400)).toBe('thirtysecond')
    // Slower where the tempo is slower.
    expect(autoSnap(map, 10, 24)).toBe('half')
  })
  it('lists the lines in a stretch, with bars and beats told apart', () => {
    const l = gridLines(flat, 1.9, 3.1, 2)
    expect(l.map((x) => x.sec)).toEqual([2, 2.25, 2.5, 2.75, 3])
    expect(l.map((x) => x.kind)).toEqual(['bar', 'sub', 'beat', 'sub', 'beat'])
    expect(gridLines(map, 8, 9, 1).map((x) => [x.sec, x.kind])).toEqual([[8, 'bar'], [9, 'beat']])
  })
  it('writes a place as bar.beat.tick and as a time', () => {
    expect(posText(flat, 0)).toBe('1.1.000')
    expect(posText(flat, 2750)).toBe('2.2.480')
    expect(posText(flat, 1999.9)).toBe('2.1.000')
    expect(posText(map, 9000)).toBe('5.2.000')
    expect(timeText(62345)).toBe('1:02.345')
    expect(timeText(0)).toBe('0:00.000')
  })
  it('reads a place typed either way', () => {
    expect(parsePos(flat, '1:02.345')).toBe(62345)
    expect(parsePos(flat, '0:01')).toBe(1000)
    expect(parsePos(flat, '1:00:00')).toBe(3600000)
    expect(parsePos(flat, '2.5s')).toBe(2500)
    expect(parsePos(flat, '8250 ms')).toBe(8250)
    expect(parsePos(flat, '2')).toBe(2000)
    expect(parsePos(flat, '2.2')).toBe(2500)
    expect(parsePos(flat, '2.2.480')).toBe(2750)
    expect(parsePos(map, '5.2')).toBe(9000)
    for (const t of ['2.5', '5.4', '0', '1.0', 'x', '1:x', '1.5:00', '2.1.960', '']) expect(parsePos(t === '5.4' ? map : flat, t)).toBe(null)
    for (const ms of [0, 1250, 2750, 9000, 12345]) expect(parsePos(map, posText(map, ms))).toBeCloseTo(ms, -1)
  })
})
