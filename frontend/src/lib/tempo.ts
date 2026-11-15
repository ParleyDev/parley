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

/**
 * The grid: whole bars, a beat or a part of one (½, ¼ and ⅛ of a beat, or a third for triplets), or `auto`, which
 * follows the zoom (`autoSnap`), or off.
 */
export type Snap = 'auto' | 'bar' | 'beat' | 'half' | 'triplet' | 'sixteenth' | 'thirtysecond' | 'off'
/** Grid lines to a beat, for a grid of a beat or finer. */
export const PER_BEAT = { beat: 1, half: 2, triplet: 3, sixteenth: 4, thirtysecond: 8 } as const
/**
 * The grid `auto` stands for at `pps` pixels a second, where the song is at `sec`: the finest whose lines are at least
 * `px` apart, so that what can be told apart on the screen can be placed on.
 */
export function autoSnap(p: Tempo, sec: number, pps: number, px = 12): Exclude<Snap, 'auto' | 'off'> {
  const beatPx = (60 / tempoAt(p, sec).bpm) * pps
  for (const s of ['thirtysecond', 'sixteenth', 'half', 'beat'] as const) if (beatPx / PER_BEAT[s] >= px) return s
  return 'bar'
}
/** Snap `ms` to the nearest grid line (`auto` as a beat: resolve it with `autoSnap` first). */
export function snapTo(p: Tempo, ms: number, snap: Snap) {
  if (snap === 'off') return ms
  const sec = ms / 1000
  if (snap === 'bar') {
    const { bar } = barBeat(p, sec)
    const a = secAtBar(p, bar - 1), b = secAtBar(p, bar)
    return (sec - a < b - sec ? a : b) * 1000
  }
  const div = snap === 'auto' ? 1 : PER_BEAT[snap]
  const b = Math.round(beatsAt(p, sec) * div) / div
  return secAtBeat(p, b) * 1000
}
/** The length of one step of the grid at `ms` (a bar, a beat or part of one). */
export function gridStep(p: Tempo, ms: number, snap: Exclude<Snap, 'auto' | 'off'>) {
  const { bpm, beats } = tempoAt(p, ms / 1000)
  return (60000 / bpm) * (snap === 'bar' ? beats : 1 / PER_BEAT[snap])
}
/**
 * The lines of the grid between `from` and `to` (seconds), `div` to a beat (1: beats only): where each is, and
 * whether it starts a bar, is a beat, or divides one.
 */
export function gridLines(p: Tempo, from: number, to: number, div: number) {
  const out: { sec: number; kind: 'bar' | 'beat' | 'sub' }[] = []
  const end = beatsAt(p, to)
  for (let k = Math.max(0, Math.ceil(beatsAt(p, Math.max(0, from)) * div - 1e-6)); k <= end * div + 1e-6 && out.length < 20000; k++) {
    const beat = k / div, whole = k % div === 0
    out.push({ sec: secAtBeat(p, beat), kind: whole ? (isDownbeat(p, beat) ? 'bar' : 'beat') : 'sub' })
  }
  return out
}

const PPQ = 960
/** Where `ms` is as bar.beat.tick (1-based bar and beat, 960 ticks to a beat): "5.2.480". */
export function posText(p: Tempo, ms: number) {
  const ticks = Math.round(beatsAt(p, Math.max(0, ms) / 1000) * PPQ), whole = Math.floor(ticks / PPQ)
  const b = barBeat(p, secAtBeat(p, whole))
  return `${b.bar}.${b.beat}.${String(ticks - whole * PPQ).padStart(3, '0')}`
}
/** "1:02.345" (minutes, seconds and milliseconds). */
export function timeText(ms: number) {
  const v = Math.max(0, Math.round(ms))
  return `${Math.floor(v / 60000)}:${String(Math.floor((v % 60000) / 1000)).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`
}
/**
 * A place typed in: a time ("1:02.345", "62.3s", "8250ms", "1:02:03.5" with hours) or bar.beat.tick ("17", "17.3",
 * "17.3.480"). Milliseconds, or null when it is neither or names a beat the bar does not have.
 */
export function parsePos(p: Tempo, text: string): number | null {
  const s = text.trim().toLowerCase().replace(',', '.')
  let m = /^(\d+(?:\.\d+)?)\s*ms$/.exec(s)
  if (m) return Math.round(Number(m[1]))
  m = /^(\d+(?:\.\d+)?)\s*s$/.exec(s)
  if (m) return Math.round(Number(m[1]) * 1000)
  if (s.includes(':')) {
    const parts = s.split(':')
    if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x)) || parts.slice(0, -1).some((x) => x.includes('.'))) return null
    return Math.round(parts.reduce((t, x) => t * 60 + Number(x), 0) * 1000)
  }
  m = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(s)
  if (!m) return null
  const bar = Number(m[1]), beat = m[2] ? Number(m[2]) : 1, tick = m[3] ? Number(m[3]) : 0
  if (bar < 1 || beat < 1 || tick >= PPQ) return null
  const start = secAtBar(p, bar - 1)
  if (beat > tempoAt(p, start).beats) return null
  return Math.round(secAtBeat(p, beatsAt(p, start) + beat - 1 + tick / PPQ) * 1000)
}
/** Bar starts (seconds) up to `until`, with their 0-based numbers. */
export function bars(p: Tempo, until: number) {
  const out: { bar: number; sec: number }[] = []
  for (let bar = 0; bar < 10000; bar++) { const sec = secAtBar(p, bar); if (sec > until) break; out.push({ bar, sec }) }
  return out
}
