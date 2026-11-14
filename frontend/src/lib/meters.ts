import studioUrl from './worklets/studio.js?url&no-inline'

/**
 * Levels as the meters show them. A reading is linear (1 = full scale): `peak` the largest sample lately, `rms` the
 * root mean square over about a third of a second. A meter that has seen a sample over full scale is latched as
 * clipped until someone clears it.
 */
export type Reading = { peak: number; rms: number }

/** The studio's processors (take capture, meter), loaded once into a context. */
const modules = new WeakMap<BaseAudioContext, Promise<void>>()
export function studioModule(ctx: BaseAudioContext) {
  let p = modules.get(ctx)
  if (!p) { p = ctx.audioWorklet.addModule(studioUrl); p.catch(() => modules.delete(ctx)); modules.set(ctx, p) }
  return p
}

/** The meters' scale: from -60 dB at the bottom to +6 dB at the top. */
export const METER_FLOOR = -60, METER_TOP = 6
export const toDb = (v: number) => (v > 1e-7 ? 20 * Math.log10(v) : -Infinity)
/** Where a level in dB sits on a meter, 0 (bottom) to 1 (top). */
export const meterPos = (db: number) => Math.max(0, Math.min(1, (db - METER_FLOOR) / (METER_TOP - METER_FLOOR)))

const clipped = new Set<string>()
export const latchClip = (id: string) => { clipped.add(id) }
export const isClipped = (id: string) => clipped.has(id)
export const clearClip = (id?: string) => { if (id === undefined) clipped.clear(); else clipped.delete(id) }

/** A reading from an analyser: its last 1024 samples (21 ms at 48 kHz, more than a frame of the screen). */
const scratch = new Float32Array(1024)
export function analyserReading(an: AnalyserNode): Reading {
  an.getFloatTimeDomainData(scratch)
  let sum = 0, peak = 0
  for (let i = 0; i < scratch.length; i++) { const v = scratch[i], a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v }
  return { peak, rms: Math.sqrt(sum / scratch.length) }
}

/** A voice activity level (0..1, as the call shows who is speaking) as a rough reading: no peak is known. */
export const fromActivity = (v: number): Reading | null => { if (v <= 0) return null; const rms = (v / 1.6) ** 2; return { peak: rms, rms } }
