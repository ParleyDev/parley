import type { StudioClip, StudioLane } from './types'

/**
 * The DAW's instruments for MIDI tracks, synthesised with Web Audio so they play the same live and in a render:
 * a subtractive synth (oscillators, filter, envelopes), a drum kit (kick, snare, hats, clap, toms, cowbell and
 * cymbals on the General MIDI notes) and a sampler that plays an audio file of the studio's across the keyboard.
 */
export type Note = { p: number; t: number; d: number; v: number }
export type SynthParams = { wave: number; detune: number; cutoff: number; reso: number; envAmt: number; a: number; d: number; s: number; r: number; gain: number }
export type Instrument =
  | { type: 'synth'; params: Partial<SynthParams> }
  | { type: 'drums'; params: { tone?: number; gain?: number } }
  | { type: 'sampler'; audio_id: string | null; root: number; params: { a?: number; r?: number; gain?: number } }

export const WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine']
export const SYNTH_DEFAULT: SynthParams = { wave: 0, detune: 8, cutoff: 2400, reso: 2, envAmt: 2000, a: 5, d: 250, s: 0.6, r: 250, gain: 0.5 }
export const SYNTH_PARAMS: { key: keyof SynthParams; label: string; min: number; max: number; step?: number; unit?: string }[] = [
  { key: 'wave', label: 'Wave (saw/sq/tri/sine)', min: 0, max: 3, step: 1 },
  { key: 'detune', label: 'Detune', min: 0, max: 50, unit: 'ct' },
  { key: 'cutoff', label: 'Cutoff', min: 60, max: 16000, unit: 'Hz' },
  { key: 'reso', label: 'Resonance', min: 0.1, max: 20, step: 0.1 },
  { key: 'envAmt', label: 'Filter env', min: 0, max: 8000, unit: 'Hz' },
  { key: 'a', label: 'Attack', min: 0, max: 2000, unit: 'ms' },
  { key: 'd', label: 'Decay', min: 0, max: 2000, unit: 'ms' },
  { key: 's', label: 'Sustain', min: 0, max: 1, step: 0.01 },
  { key: 'r', label: 'Release', min: 0, max: 4000, unit: 'ms' },
  { key: 'gain', label: 'Level', min: 0, max: 1, step: 0.01 },
]
/** General MIDI drum notes the kit plays, with names for the piano roll. */
export const DRUMS: Record<number, string> = { 36: 'Kick', 38: 'Snare', 39: 'Clap', 42: 'Closed hat', 46: 'Open hat', 41: 'Low tom', 45: 'Mid tom', 48: 'High tom', 49: 'Crash', 51: 'Ride', 56: 'Cowbell' }
export const defaultInstrument = (type: Instrument['type']): Instrument => type === 'synth' ? { type, params: { ...SYNTH_DEFAULT } } : type === 'drums' ? { type, params: { tone: 0.5, gain: 0.8 } } : { type, audio_id: null, root: 60, params: { a: 2, r: 200, gain: 0.8 } }

const hz = (p: number) => 440 * Math.pow(2, (p - 69) / 12)
let noiseBuf: AudioBuffer | null = null
function noise(ctx: BaseAudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0)
  let seed = 22222
  for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x7fffffff) * 2 - 1 }
  return (noiseBuf = b)
}

/** One drum hit at `when`; sources it made go to `out`. */
function drum(ctx: BaseAudioContext, dest: AudioNode, p: number, vel: number, when: number, tone: number, out: AudioScheduledSourceNode[]) {
  const g = ctx.createGain(); g.connect(dest)
  const v = vel / 127
  const env = (peak: number, decay: number) => { g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * v), when + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, when + decay) }
  const osc = (type: OscillatorType, f0: number, f1: number, dur: number) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur); o.connect(g); o.start(when); o.stop(when + dur + 0.05); out.push(o) }
  const nz = (type: BiquadFilterType, f: number, dur: number) => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; s.connect(fl).connect(g); s.start(when); s.stop(when + dur + 0.05); out.push(s) }
  const t = 0.6 + tone * 0.8
  switch (p) {
    case 36: env(1, 0.45); osc('sine', 150 * t, 45, 0.4); break
    case 38: env(0.8, 0.22); nz('highpass', 1200 * t, 0.2); osc('triangle', 220 * t, 120, 0.12); break
    case 39: env(0.7, 0.25); nz('bandpass', 1500 * t, 0.22); break
    case 42: env(0.45, 0.06); nz('highpass', 8000 * t, 0.06); break
    case 46: env(0.45, 0.35); nz('highpass', 7000 * t, 0.35); break
    case 41: case 45: case 48: { const f = { 41: 90, 45: 130, 48: 180 }[p]! * t; env(0.9, 0.35); osc('sine', f * 1.6, f, 0.3); break }
    case 49: env(0.5, 1.4); nz('highpass', 5000 * t, 1.4); break
    case 51: env(0.35, 0.9); nz('bandpass', 9000 * t, 0.9); break
    case 56: env(0.5, 0.3); osc('square', 800 * t, 790 * t, 0.25); osc('square', 540 * t, 535 * t, 0.25); break
    default: env(0.5, 0.15); nz('bandpass', 400 + p * 40, 0.15)
  }
}

/**
 * Play a note on an instrument: from `when` for `dur` seconds (null: until the returned release is called, for
 * live playing). `sample` is the sampler's decoded file.
 */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, inst: Instrument, p: number, vel: number, when: number, dur: number | null, out: AudioScheduledSourceNode[], sample?: AudioBuffer): (at?: number) => void {
  if (inst.type === 'drums') { drum(ctx, dest, p, vel, when, inst.params.tone ?? 0.5, out); return () => {} }
  const v = vel / 127
  if (inst.type === 'sampler') {
    if (!sample) return () => {}
    const s = ctx.createBufferSource(); s.buffer = sample; s.playbackRate.value = Math.pow(2, (p - (inst.root ?? 60)) / 12)
    const g = ctx.createGain(), a = (inst.params.a ?? 2) / 1000, r = (inst.params.r ?? 200) / 1000, lvl = (inst.params.gain ?? 0.8) * v
    s.connect(g).connect(dest)
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(lvl, when + a)
    s.start(when); out.push(s)
    const release = (at = (ctx as AudioContext).currentTime) => { g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(g.gain.value || lvl, at); g.gain.linearRampToValueAtTime(0, at + r); try { s.stop(at + r + 0.05) } catch { /* stopped */ } }
    if (dur !== null) release(when + dur)
    return release
  }
  const sp = { ...SYNTH_DEFAULT, ...inst.params }
  const g = ctx.createGain(), f = ctx.createBiquadFilter()
  f.type = 'lowpass'; f.Q.value = sp.reso
  f.connect(g).connect(dest)
  const a = sp.a / 1000, d = sp.d / 1000, r = sp.r / 1000, lvl = sp.gain * v
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(lvl, when + a + 0.002); g.gain.linearRampToValueAtTime(lvl * sp.s, when + a + d + 0.002)
  f.frequency.setValueAtTime(sp.cutoff, when); f.frequency.linearRampToValueAtTime(Math.min(20000, sp.cutoff + sp.envAmt), when + a + 0.002); f.frequency.linearRampToValueAtTime(Math.min(20000, sp.cutoff + sp.envAmt * sp.s), when + a + d + 0.002)
  const oscs = [-1, 1].map((side) => { const o = ctx.createOscillator(); o.type = WAVES[Math.round(sp.wave)] ?? 'sawtooth'; o.frequency.value = hz(p); o.detune.value = side * sp.detune; o.connect(f); o.start(when); out.push(o); return o })
  const release = (at = (ctx as AudioContext).currentTime) => {
    g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(lvl * sp.s, at); g.gain.linearRampToValueAtTime(0, at + r)
    oscs.forEach((o) => { try { o.stop(at + r + 0.05) } catch { /* stopped */ } })
  }
  if (dur !== null) release(when + Math.max(dur, a + 0.01))
  return release
}

/** Schedule a MIDI clip's notes that start in [from, to) ms (the clip starting at `start` on the timeline). */
export function scheduleNotes(ctx: BaseAudioContext, dest: AudioNode, lane: StudioLane, c: StudioClip, start: number, from: number, to: number, t0: number, out: AudioScheduledSourceNode[], sample?: AudioBuffer) {
  const inst = (lane.instrument as Instrument | null | undefined) ?? defaultInstrument('synth')
  const g = ctx.createGain(); g.gain.value = c.gain; g.connect(dest)
  for (const n of (c.notes ?? []) as Note[]) {
    if (n.t < 0 || n.t >= c.length_ms) continue
    const at = start + n.t
    if (at < from || at >= to) continue
    playNote(ctx, g, inst, n.p, n.v, t0 + at / 1000, Math.min(n.d, c.length_ms - n.t) / 1000, out, sample)
  }
}
