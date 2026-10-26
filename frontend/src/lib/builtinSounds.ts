/**
 * Built-in soundboard sounds, synthesised (no asset files) into WAV blob URLs on first use. Ids match the server's
 * `sounds::BUILTINS`; a sound plays as `builtin:<id>`.
 */
export const BUILTIN_SOUNDS = [
  { id: 'airhorn', name: 'Airhorn', emoji: '📯' }, { id: 'crickets', name: 'Crickets', emoji: '🦗' }, { id: 'rimshot', name: 'Ba Dum Tss', emoji: '🥁' },
  { id: 'clap', name: 'Golf Clap', emoji: '👏' }, { id: 'quack', name: 'Quack', emoji: '🦆' }, { id: 'boing', name: 'Boing', emoji: '🎈' },
  { id: 'tada', name: 'Tada', emoji: '🎉' }, { id: 'sadtrombone', name: 'Sad Trombone', emoji: '🎺' },
] as const

const RATE = 22050
type Gen = (t: number) => number
const tone = (f: number | ((t: number) => number), shape: 'sine' | 'square' | 'saw' = 'sine') => {
  let phase = 0, last = 0
  return (t: number) => {
    const freq = typeof f === 'number' ? f : f(t)
    phase += (freq / RATE) * (t > last ? 1 : 0); last = t
    const x = phase % 1
    return shape === 'square' ? (x < 0.5 ? 1 : -1) : shape === 'saw' ? 2 * x - 1 : Math.sin(2 * Math.PI * x)
  }
}
const env = (a: number, d: number, len: number) => (t: number) => (t < a ? t / a : t > len - d ? Math.max(0, (len - t) / d) : 1)
const noise = () => Math.random() * 2 - 1

const RECIPES: Record<string, { len: number; gen: () => Gen }> = {
  airhorn: { len: 1.1, gen: () => { const a = tone(466, 'saw'), b = tone(554, 'saw'), c = tone(349, 'saw'), e = env(0.02, 0.15, 1.1); return (t) => (a(t) + b(t) * 0.8 + c(t) * 0.6) * 0.3 * e(t) * (t % 0.37 < 0.32 ? 1 : 0.2) } },
  crickets: { len: 1.6, gen: () => { const a = tone(4400); return (t) => a(t) * ((t % 0.4) < 0.12 && (t * 60) % 1 < 0.5 ? 0.35 : 0) } },
  rimshot: { len: 1.0, gen: () => { const k = tone((t) => 120 - t * 200), e = env(0.001, 0.6, 1.0); return (t) => (t < 0.12 ? k(t) * 0.8 * (1 - t / 0.12) : 0) + (t > 0.2 && t < 0.3 ? noise() * 0.5 * (1 - (t - 0.2) / 0.1) : 0) + (t > 0.42 ? noise() * 0.35 * Math.exp(-(t - 0.42) * 4) * e(t) : 0) } },
  clap: { len: 1.6, gen: () => (t) => { const beat = t % 0.4; return beat < 0.05 ? noise() * 0.6 * (1 - beat / 0.05) : 0 } },
  quack: { len: 0.4, gen: () => { const a = tone((t) => 520 - t * 500, 'saw'), e = env(0.01, 0.15, 0.4); return (t) => a(t) * 0.45 * e(t) } },
  boing: { len: 0.8, gen: () => { const a = tone((t) => 180 + 120 * Math.sin(t * 40) * Math.exp(-t * 4)), e = env(0.005, 0.3, 0.8); return (t) => a(t) * 0.6 * e(t) } },
  tada: { len: 1.2, gen: () => { const n = [523, 659, 784, 1047]; const ts = n.map((f) => tone(f, 'square')), e = env(0.01, 0.4, 1.2); return (t) => (t < 0.12 ? ts[0](t) : t < 0.24 ? ts[1](t) : (ts[2](t) + ts[3](t)) * 0.6) * 0.18 * e(t) } },
  sadtrombone: { len: 2.2, gen: () => { const notes = [392, 370, 349, 330]; const ts = notes.map((f, i) => tone(i === 3 ? (t: number) => f + Math.sin(t * 30) * 8 : f, 'saw')); return (t) => { const i = Math.min(3, Math.floor(t / 0.5)); const local = t - i * 0.5; return ts[i](t) * 0.25 * Math.min(1, local * 20) * (i === 3 ? Math.max(0, 1 - (t - 1.5) / 0.7) : local < 0.45 ? 1 : 0.3) } } },
}

function wav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true)
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true))
  return new Blob([buf], { type: 'audio/wav' })
}

const cache = new Map<string, string>()
/** A playable URL for a built-in sound id (with or without the `builtin:` prefix); '' if unknown. */
export function builtinUrl(id: string): string {
  const key = id.replace(/^builtin:/, '')
  const hit = cache.get(key)
  if (hit) return hit
  const r = RECIPES[key]
  if (!r) return ''
  const g = r.gen(), n = Math.floor(r.len * RATE), out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = g(i / RATE)
  const url = URL.createObjectURL(wav(out))
  cache.set(key, url)
  return url
}
