import type { StudioProject } from './types'

/**
 * The project's tempo map: it starts at the project's tempo and time signature, and `tempo_map` changes them from a
 * given bar on ([{bar, bpm, beats}], bar 0 being the first). Beats are counted from the start of the song across all
 * the changes; these convert between beats, bars and seconds, and give the grid lines to draw and snap to.
 */
export type TempoChange = { bar: number; bpm: number; beats: number }
type Seg = { bar: number; beat: number; sec: number; bpm: number; beats: number }
type Tempo = Pick<StudioProject, 'bpm' | 'beats'> & { tempo_map?: TempoChange[] | null }

const cache = new WeakMap<object, Seg[]>()
function segments(p: Tempo): Seg[] {
  const hit = cache.get(p)
  if (hit) return hit
  const list = [...(p.tempo_map ?? [])].filter((c) => c.bar > 0).sort((a, b) => a.bar - b.bar)
  const segs: Seg[] = [{ bar: 0, beat: 0, sec: 0, bpm: p.bpm, beats: p.beats }]
  for (const c of list) {
    const s = segs[segs.length - 1]
    if (c.bar <= s.bar) { Object.assign(s, { bpm: c.bpm, beats: c.beats }); continue }
    const beat = s.beat + (c.bar - s.bar) * s.beats
    segs.push({ bar: c.bar, beat, sec: s.sec + ((beat - s.beat) * 60) / s.bpm, bpm: c.bpm, beats: c.beats })
  }
  cache.set(p, segs)
  return segs
}
const segAtSec = (segs: Seg[], sec: number) => { let s = segs[0]; for (const x of segs) if (x.sec <= sec + 1e-9) s = x; return s }
const segAtBeat = (segs: Seg[], beat: number) => { let s = segs[0]; for (const x of segs) if (x.beat <= beat + 1e-9) s = x; return s }

/** Beats from the start of the song at `sec` (fractional). */
export function beatsAt(p: Tempo, sec: number) { const s = segAtSec(segments(p), sec); return s.beat + ((sec - s.sec) * s.bpm) / 60 }
/** Seconds at beat `n` from the start (fractional beats too). */
export function secAtBeat(p: Tempo, n: number) { const s = segAtBeat(segments(p), n); return s.sec + ((n - s.beat) * 60) / s.bpm }
/** Does beat `n` (whole) start a bar? */
export function isDownbeat(p: Tempo, n: number) { const s = segAtBeat(segments(p), n); return (n - s.beat) % s.beats === 0 }
/** Bar and beat (1-based, for display) at `sec`. */
export function barBeat(p: Tempo, sec: number) {
  const segs = segments(p), b = beatsAt(p, sec), s = segAtBeat(segs, b)
  const into = Math.floor(b - s.beat + 1e-6)
  return { bar: s.bar + Math.floor(into / s.beats) + 1, beat: (into % s.beats) + 1, bpm: s.bpm, beats: s.beats }
}
/** Seconds at the start of bar `bar` (0-based). */
export function secAtBar(p: Tempo, bar: number) { const segs = segments(p); let s = segs[0]; for (const x of segs) if (x.bar <= bar) s = x; return secAtBeat(p, s.beat + (bar - s.bar) * s.beats) }
/** The tempo in force at `sec`. */
export const tempoAt = (p: Tempo, sec: number) => { const s = segAtSec(segments(p), sec); return { bpm: s.bpm, beats: s.beats } }

export type Snap = 'bar' | 'beat' | 'half' | 'sixteenth' | 'off'
/** Snap `ms` to the nearest grid line. */
export function snapTo(p: Tempo, ms: number, snap: Snap) {
  if (snap === 'off') return ms
  const sec = ms / 1000
  if (snap === 'bar') {
    const { bar } = barBeat(p, sec)
    const a = secAtBar(p, bar - 1), b = secAtBar(p, bar)
    return (sec - a < b - sec ? a : b) * 1000
  }
  const div = snap === 'beat' ? 1 : snap === 'half' ? 2 : 4
  const b = Math.round(beatsAt(p, sec) * div) / div
  return secAtBeat(p, b) * 1000
}
/** Bar starts (seconds) up to `until`, with their 0-based numbers. */
export function bars(p: Tempo, until: number) {
  const out: { bar: number; sec: number }[] = []
  for (let bar = 0; bar < 10000; bar++) { const sec = secAtBar(p, bar); if (sec > until) break; out.push({ bar, sec }) }
  return out
}
