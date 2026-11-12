/**
 * The DAW's effects, built from Web Audio nodes so they run the same live and in an offline render. Each type lists
 * its parameters (range, default, unit); `build` makes the nodes and returns an input, an output, a way to set
 * parameters, and the AudioParams that automation can drive (with the conversion from the parameter's unit).
 */
export type FxType = 'eq' | 'compressor' | 'reverb' | 'delay' | 'drive' | 'filter' | 'limiter' | 'chorus'
export interface Effect { id: string; type: FxType; on: boolean; params: Record<string, number> }
export interface ParamDef { key: string; label: string; min: number; max: number; def: number; step?: number; unit?: string; log?: boolean; /** Can be automated. */ auto?: boolean }
export interface FxDef { type: FxType; name: string; params: ParamDef[] }

export const FX: Record<FxType, FxDef> = {
  eq: { type: 'eq', name: 'EQ', params: [
    { key: 'lowcut', label: 'Low cut', min: 20, max: 500, def: 20, unit: 'Hz', log: true, auto: true },
    { key: 'low', label: 'Low', min: -15, max: 15, def: 0, step: 0.5, unit: 'dB', auto: true },
    { key: 'midFreq', label: 'Mid freq', min: 200, max: 5000, def: 1000, unit: 'Hz', log: true, auto: true },
    { key: 'mid', label: 'Mid', min: -15, max: 15, def: 0, step: 0.5, unit: 'dB', auto: true },
    { key: 'high', label: 'High', min: -15, max: 15, def: 0, step: 0.5, unit: 'dB', auto: true },
  ] },
  compressor: { type: 'compressor', name: 'Compressor', params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, def: -18, step: 0.5, unit: 'dB', auto: true },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, step: 0.1, unit: ':1', auto: true },
    { key: 'attack', label: 'Attack', min: 0, max: 200, def: 10, unit: 'ms' },
    { key: 'release', label: 'Release', min: 10, max: 1000, def: 200, unit: 'ms' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 24, def: 0, step: 0.5, unit: 'dB', auto: true },
  ] },
  reverb: { type: 'reverb', name: 'Reverb', params: [
    { key: 'size', label: 'Decay', min: 0.2, max: 8, def: 2, step: 0.1, unit: 's' },
    { key: 'tone', label: 'Tone', min: 1000, max: 20000, def: 8000, unit: 'Hz', log: true, auto: true },
    { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.25, step: 0.01, auto: true },
  ] },
  delay: { type: 'delay', name: 'Delay', params: [
    { key: 'time', label: 'Time', min: 1, max: 2000, def: 375, unit: 'ms', auto: true },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, def: 0.35, step: 0.01, auto: true },
    { key: 'tone', label: 'Tone', min: 500, max: 20000, def: 6000, unit: 'Hz', log: true, auto: true },
    { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.3, step: 0.01, auto: true },
  ] },
  drive: { type: 'drive', name: 'Drive', params: [
    { key: 'amount', label: 'Drive', min: 0, max: 100, def: 30 },
    { key: 'tone', label: 'Tone', min: 500, max: 20000, def: 12000, unit: 'Hz', log: true, auto: true },
    { key: 'output', label: 'Output', min: -24, max: 12, def: 0, step: 0.5, unit: 'dB', auto: true },
    { key: 'mix', label: 'Mix', min: 0, max: 1, def: 1, step: 0.01, auto: true },
  ] },
  filter: { type: 'filter', name: 'Filter', params: [
    { key: 'mode', label: 'Mode (LP/HP/BP)', min: 0, max: 2, def: 0, step: 1 },
    { key: 'freq', label: 'Cutoff', min: 20, max: 20000, def: 1000, unit: 'Hz', log: true, auto: true },
    { key: 'q', label: 'Resonance', min: 0.1, max: 20, def: 0.7, step: 0.1, auto: true },
  ] },
  limiter: { type: 'limiter', name: 'Limiter', params: [
    { key: 'ceiling', label: 'Ceiling', min: -24, max: 0, def: -1, step: 0.1, unit: 'dB', auto: true },
    { key: 'release', label: 'Release', min: 10, max: 1000, def: 100, unit: 'ms' },
  ] },
  chorus: { type: 'chorus', name: 'Chorus', params: [
    { key: 'rate', label: 'Rate', min: 0.1, max: 8, def: 1.5, step: 0.1, unit: 'Hz', auto: true },
    { key: 'depth', label: 'Depth', min: 0, max: 10, def: 3, step: 0.1, unit: 'ms', auto: true },
    { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, step: 0.01, auto: true },
  ] },
}

export const fxParam = (type: FxType, key: string) => FX[type]?.params.find((p) => p.key === key)
export const newEffect = (type: FxType): Effect => ({ id: crypto.randomUUID().slice(0, 8), type, on: true, params: Object.fromEntries(FX[type].params.map((p) => [p.key, p.def])) })
const val = (e: Effect, key: string) => e.params[key] ?? fxParam(e.type, key)?.def ?? 0
export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** An automatable parameter: the AudioParam and how a value in the parameter's unit becomes its value. */
export type Target = { param: AudioParam; to?: (v: number) => number }
export interface FxNode { input: AudioNode; output: AudioNode; set: (e: Effect) => void; targets: Record<string, Target>; stop: () => void }

/** A reverb's impulse: decaying stereo noise `size` seconds long. */
function impulse(ctx: BaseAudioContext, size: number) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * size))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let seed = 1234567 + c * 7654321
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / len, 3) }
  }
  return buf
}
function curve(amount: number) {
  const k = amount * 2, n = 2048, c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = k ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x }
  return c
}

/** A dry/wet pair around `wet`: input → (dry, wet chain) → output. */
function dryWet(ctx: BaseAudioContext) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain()
  input.connect(dry).connect(output); wet.connect(output)
  return { input, output, dry, wet, mix: (m: number) => { dry.gain.value = 1 - m; wet.gain.value = m } }
}

export function buildEffect(ctx: BaseAudioContext, e: Effect): FxNode {
  const ms = (v: number) => v / 1000
  switch (e.type) {
    case 'eq': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7
      const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.Q.value = 1
      const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 8000
      hp.connect(lo).connect(mid).connect(hi)
      const set = (x: Effect) => { hp.frequency.value = val(x, 'lowcut'); lo.gain.value = val(x, 'low'); mid.frequency.value = val(x, 'midFreq'); mid.gain.value = val(x, 'mid'); hi.gain.value = val(x, 'high') }
      set(e)
      return { input: hp, output: hi, set, targets: { lowcut: { param: hp.frequency }, low: { param: lo.gain }, midFreq: { param: mid.frequency }, mid: { param: mid.gain }, high: { param: hi.gain } }, stop: () => {} }
    }
    case 'compressor': {
      const c = ctx.createDynamicsCompressor(), g = ctx.createGain()
      c.knee.value = 6; c.connect(g)
      const set = (x: Effect) => { c.threshold.value = val(x, 'threshold'); c.ratio.value = val(x, 'ratio'); c.attack.value = ms(val(x, 'attack')); c.release.value = ms(val(x, 'release')); g.gain.value = dbToGain(val(x, 'makeup')) }
      set(e)
      return { input: c, output: g, set, targets: { threshold: { param: c.threshold }, ratio: { param: c.ratio }, makeup: { param: g.gain, to: dbToGain } }, stop: () => {} }
    }
    case 'reverb': {
      const dw = dryWet(ctx), conv = ctx.createConvolver(), tone = ctx.createBiquadFilter()
      tone.type = 'lowpass'
      dw.input.connect(conv).connect(tone).connect(dw.wet)
      let size = -1
      const set = (x: Effect) => { const s = val(x, 'size'); if (s !== size) { size = s; conv.buffer = impulse(ctx, s) } tone.frequency.value = val(x, 'tone'); dw.mix(val(x, 'mix')) }
      set(e)
      return { input: dw.input, output: dw.output, set, targets: { tone: { param: tone.frequency }, mix: { param: dw.wet.gain } }, stop: () => {} }
    }
    case 'delay': {
      const dw = dryWet(ctx), d = ctx.createDelay(2.5), fb = ctx.createGain(), tone = ctx.createBiquadFilter()
      tone.type = 'lowpass'
      dw.input.connect(d); d.connect(tone).connect(dw.wet); tone.connect(fb).connect(d)
      const set = (x: Effect) => { d.delayTime.value = ms(val(x, 'time')); fb.gain.value = val(x, 'feedback'); tone.frequency.value = val(x, 'tone'); dw.mix(val(x, 'mix')) }
      set(e)
      return { input: dw.input, output: dw.output, set, targets: { time: { param: d.delayTime, to: ms }, feedback: { param: fb.gain }, tone: { param: tone.frequency }, mix: { param: dw.wet.gain } }, stop: () => {} }
    }
    case 'drive': {
      const dw = dryWet(ctx), sh = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), out = ctx.createGain()
      sh.oversample = '4x'; tone.type = 'lowpass'
      dw.input.connect(sh).connect(tone).connect(dw.wet)
      dw.output.connect(out)
      let amt = -1
      const set = (x: Effect) => { const a = val(x, 'amount'); if (a !== amt) { amt = a; sh.curve = curve(a) } tone.frequency.value = val(x, 'tone'); out.gain.value = dbToGain(val(x, 'output')); dw.mix(val(x, 'mix')) }
      set(e)
      return { input: dw.input, output: out, set, targets: { tone: { param: tone.frequency }, output: { param: out.gain, to: dbToGain }, mix: { param: dw.wet.gain } }, stop: () => {} }
    }
    case 'filter': {
      const f = ctx.createBiquadFilter()
      const set = (x: Effect) => { f.type = (['lowpass', 'highpass', 'bandpass'] as const)[Math.round(val(x, 'mode'))] ?? 'lowpass'; f.frequency.value = val(x, 'freq'); f.Q.value = val(x, 'q') }
      set(e)
      return { input: f, output: f, set, targets: { freq: { param: f.frequency }, q: { param: f.Q } }, stop: () => {} }
    }
    case 'limiter': {
      const c = ctx.createDynamicsCompressor()
      c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001
      const set = (x: Effect) => { c.threshold.value = val(x, 'ceiling'); c.release.value = ms(val(x, 'release')) }
      set(e)
      return { input: c, output: c, set, targets: { ceiling: { param: c.threshold } }, stop: () => {} }
    }
    case 'chorus': {
      const dw = dryWet(ctx), d = ctx.createDelay(0.1), lfo = ctx.createOscillator(), depth = ctx.createGain()
      d.delayTime.value = 0.02
      lfo.connect(depth).connect(d.delayTime)
      dw.input.connect(d).connect(dw.wet)
      lfo.start()
      const set = (x: Effect) => { lfo.frequency.value = val(x, 'rate'); depth.gain.value = ms(val(x, 'depth')); dw.mix(val(x, 'mix')) }
      set(e)
      return { input: dw.input, output: dw.output, set, targets: { rate: { param: lfo.frequency }, depth: { param: depth.gain, to: ms }, mix: { param: dw.wet.gain } }, stop: () => { try { lfo.stop() } catch { /* not started */ } } }
    }
  }
}

/** A chain of effects between `input` and `output` (bypassed ones left out); the built nodes by effect id. */
export function buildChain(ctx: BaseAudioContext, list: Effect[], input: AudioNode, output: AudioNode) {
  const nodes = new Map<string, FxNode>()
  let at: AudioNode = input
  for (const e of list) {
    if (!e.on || !FX[e.type]) continue
    const n = buildEffect(ctx, e)
    at.connect(n.input); at = n.output
    nodes.set(e.id, n)
  }
  at.connect(output)
  return nodes
}

/** The shape of a chain (what is in it and in what order): a change means rebuilding, not just setting values. */
export const chainKey = (list: Effect[]) => list.map((e) => `${e.id}:${e.type}:${e.on ? 1 : 0}`).join(',')

/**
 * Integrated loudness (LUFS, ITU-R BS.1770 / EBU R128): K-weighted, 400 ms blocks overlapping by 75 %, gated at
 * -70 LUFS and then 10 LU below the ungated level. Null for silence.
 */
export async function integratedLufs(buf: AudioBuffer): Promise<number | null> {
  const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate)
  const src = off.createBufferSource(); src.buffer = buf
  const shelf = off.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5
  src.connect(shelf).connect(hp).connect(off.destination); src.start()
  const k = await off.startRendering()
  const block = Math.round(0.4 * k.sampleRate), step = Math.round(block / 4)
  const chans = Array.from({ length: k.numberOfChannels }, (_, c) => k.getChannelData(c))
  const powers: number[] = []
  for (let s = 0; s + block <= k.length; s += step) {
    let p = 0
    for (const d of chans) { let sum = 0; for (let i = s; i < s + block; i++) sum += d[i] * d[i]; p += sum / block }
    powers.push(p)
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const abs = powers.filter((p) => p > 0 && lufs(p) > -70)
  if (!abs.length) return null
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
  const gated = abs.filter((p) => lufs(p) > rel)
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length)
}
