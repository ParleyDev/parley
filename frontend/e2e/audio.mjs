// Audio for the studio suites: test signals as WAV files, what the DAW rendered pulled out of the page as samples,
// and measurements on them (level, where an impulse is, how far one signal lags another). With these a suite can say
// what a mix sounds like, not only what the screen shows.
//
// The page side is `window.__parleyDawTest` (src/lib/daw.ts): render() gives the project (or stems) rendered offline,
// wav() the exported file, tap() what is playing as a stream.

// ---- signals -------------------------------------------------------------------------------------------------

/** A sine at `hz`, peaking at `amp`. */
export const sine = (hz, amp = 0.5) => (i, rate) => amp * Math.sin((2 * Math.PI * hz * i) / rate)
/** A constant level: what comes out is the gain it went through. */
export const dc = (level = 0.5) => () => level
/** Single-sample clicks at the given times (ms), silence between. */
export const impulses = (atMs, amp = 0.9) => (i, rate) => (atMs.some((ms) => Math.round((ms * rate) / 1000) === i) ? amp : 0)
/** Short bursts of a 1 kHz tone starting at the given times (ms): an impulse that survives a lossy codec. */
export const bursts = (atMs, amp = 0.8, lenMs = 20) => (i, rate) => { const ms = (i * 1000) / rate; const at = atMs.find((a) => ms >= a && ms < a + lenMs); return at === undefined ? 0 : amp * Math.sin((2 * Math.PI * 1000 * (ms - at)) / 1000) }
export const silence = () => 0

/**
 * A 16-bit PCM WAV: `seconds` of `signal(i, rate, channel)` at `rate`. Pass one signal for every channel or one per
 * channel. A sample of 0.5 is stored as exactly half of full scale, so it decodes to exactly 0.5.
 */
export function wavFile({ seconds, rate = 48000, signal = silence }) {
  const sigs = Array.isArray(signal) ? signal : [signal], ch = sigs.length, n = Math.round(seconds * rate)
  const buf = Buffer.alloc(44 + n * ch * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40)
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sigs[c](i, rate, c) * 32768))), 44 + (i * ch + c) * 2)
  return buf
}

/** Read a PCM WAV (16- or 24-bit) back: its header and its channels as floats. */
export function parseWav(bytes) {
  const b = Buffer.from(bytes)
  const tag = (o) => b.toString('latin1', o, o + 4)
  const head = { riff: tag(0), wave: tag(8), fmt: tag(12), data: tag(36), riffSize: b.readUInt32LE(4), format: b.readUInt16LE(20), channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), byteRate: b.readUInt32LE(28), blockAlign: b.readUInt16LE(32), bits: b.readUInt16LE(34), dataSize: b.readUInt32LE(40), size: b.length }
  const frames = Math.floor(head.dataSize / head.blockAlign)
  const channels = Array.from({ length: head.channels }, () => new Float32Array(frames))
  if (head.bits === 16) for (let i = 0; i < frames; i++) for (let c = 0; c < head.channels; c++) channels[c][i] = b.readInt16LE(44 + (i * head.channels + c) * 2) / 32768
  // 24 bits fit a float exactly: what is read is what was stored.
  if (head.bits === 24) for (let i = 0; i < frames; i++) for (let c = 0; c < head.channels; c++) channels[c][i] = b.readIntLE(44 + (i * head.channels + c) * 3, 3) / 8388608
  return { ...head, frames, samples: channels }
}

// ---- out of the page -----------------------------------------------------------------------------------------

const unpack = (r) => r && { rate: r.rate, frames: r.frames, samples: r.channels.map((s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice() }) }
// Runs in the page: an AudioBuffer as base64 floats per channel.
const pack = `(buf) => { if (!buf) return null; const out = []; for (let c = 0; c < buf.numberOfChannels; c++) { const u = new Uint8Array(buf.getChannelData(c).slice().buffer); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); out.push(btoa(s)) } return { rate: buf.sampleRate, frames: buf.length, channels: out } }`

/**
 * The open project rendered offline by the DAW, as samples: the whole mix, or only the lanes in `only` (a stem).
 * `heard` keeps solo in it (what the member hears); an export does not.
 */
export const pullRender = async (page, only, heard = false) => unpack(await page.evaluate(`(async () => (${pack})(await window.__parleyDawTest.render(${only ? JSON.stringify(only) : 'undefined'}, ${heard})))()`))
/** The mix as the WAV file an export writes: 24-bit, or 16-bit (dithered). */
export const pullWav = async (page, bits = 24) => { const s = await page.evaluate(`(async () => { const w = await window.__parleyDawTest.wav(${bits}); if (!w) return null; const u = new Uint8Array(w); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s) })()`); return s ? parseWav(Buffer.from(s, 'base64')) : null }
/** The sample rate the page's audio runs at (the DAW decodes files at this rate, and renders at 48 kHz). */
export const liveRate = (page) => page.evaluate(() => window.__parleyDawTest.context().sampleRate)
/** Stored audio (a take, an import) decoded by the page to mono samples at `rate`. */
export const pullAudio = async (page, url, token, rate = 48000) => unpack(await page.evaluate(`(async () => { const r = await fetch(${JSON.stringify(url)}, { headers: { Authorization: 'Bearer ${token}' } }); if (!r.ok) return null; const probe = new OfflineAudioContext(1, 1, ${rate}); const buf = await probe.decodeAudioData(await r.arrayBuffer()); return (${pack})(buf) })()`))

// ---- measurements --------------------------------------------------------------------------------------------

const span = (x, rate, fromMs, toMs) => [Math.max(0, Math.round((fromMs * rate) / 1000)), Math.min(x.length, toMs === undefined ? x.length : Math.round((toMs * rate) / 1000))]
/** Highest absolute sample in [fromMs, toMs). */
export function peak(x, rate, fromMs = 0, toMs) { const [a, b] = span(x, rate, fromMs, toMs); let m = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v } return m }
/** RMS level in [fromMs, toMs). */
export function rms(x, rate, fromMs = 0, toMs) { const [a, b] = span(x, rate, fromMs, toMs); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return b > a ? Math.sqrt(s / (b - a)) : 0 }
/** Mean sample in [fromMs, toMs): the level of a DC signal. */
export function mean(x, rate, fromMs = 0, toMs) { const [a, b] = span(x, rate, fromMs, toMs); let s = 0; for (let i = a; i < b; i++) s += x[i]; return b > a ? s / (b - a) : 0 }
/** The sample at `ms`. */
export const at = (x, rate, ms) => x[Math.round((ms * rate) / 1000)]
export const db = (v) => 20 * Math.log10(Math.max(v, 1e-12))
export const near = (v, want, tol = 1e-3) => Math.abs(v - want) <= tol
/** The first sample (index) at or over `threshold` from `fromMs` on; -1 if none. */
export function firstOver(x, rate, threshold, fromMs = 0) { for (let i = Math.round((fromMs * rate) / 1000); i < x.length; i++) if (Math.abs(x[i]) >= threshold) return i; return -1 }
/** Where the onsets are (sample indexes): each first sample over `threshold` after at least `gapMs` under it. */
export function onsets(x, rate, threshold, gapMs = 100) {
  const out = [], gap = Math.round((gapMs * rate) / 1000)
  let last = -Infinity
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= threshold) { if (i - last > gap) out.push(i); last = i }
  return out
}
/**
 * How many samples `b` lags `a` (negative: it leads), by the best match of the two within ±`maxLag` samples, and how
 * good the match is (1: the same shape).
 */
export function lag(a, b, maxLag) {
  const n = Math.min(a.length, b.length)
  let best = 0, top = -Infinity, ea = 0, eb = 0
  for (let i = 0; i < n; i++) { ea += a[i] * a[i]; eb += b[i] * b[i] }
  for (let l = -maxLag; l <= maxLag; l++) {
    let s = 0
    for (let i = Math.max(0, -l); i < Math.min(n, n - l); i++) s += a[i] * b[i + l]
    if (s > top) { top = s; best = l }
  }
  return { lag: best, match: ea && eb ? top / Math.sqrt(ea * eb) : 0 }
}
/** The largest difference between two signals over [fromMs, toMs). */
export function maxDiff(a, b, rate, fromMs = 0, toMs) { const [s, e] = span(a.length < b.length ? a : b, rate, fromMs, toMs); let m = 0; for (let i = s; i < e; i++) { const v = Math.abs(a[i] - b[i]); if (v > m) m = v } return m }
/** Equal-power pan: what a mono signal's left and right are multiplied by at `pan` (-1 … 1). */
export const panLaw = (pan) => { const x = ((pan + 1) / 2) * (Math.PI / 2); return [Math.cos(x), Math.sin(x)] }

// ---- an input the test knows to the sample ------------------------------------------------------------------

/** Noise that is the same wherever it is made: `n` floats in [-0.5, 0.5) from `seed`. */
export function noise(n, seed = 1) {
  const out = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s / 4294967296 - 0.5 }
  return out
}
/** What a float becomes stored at 24 bits and read back. */
export const as24 = (v) => Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608))) / 8388608

/**
 * For `context.addInitScript(studioInput, mode)`: gives the studio recorder a node of the DAW's own audio graph as its
 * microphone (`window.__parleyStudioInput`, read by src/lib/studio.ts), so what a take should hold is known exactly.
 * 'loop': what the DAW plays (after the master, without the click), 100 ms late: a player who is exactly 100 ms behind.
 * 'noise': silence until `window.__studioIn.play(frames, seed)` plays that much of `noise` once.
 * 'hum': `HUM` frames of `noise` (seed 7) round and round, from before any take starts (see `humCheck`).
 */
export function studioInput(mode) {
  const st = (window.__studioIn = { mode, node: null })
  window.__parleyStudioInput = (ctx) => {
    if (st.node) return st.node
    if (mode === 'loop') { st.node = ctx.createDelay(1); st.node.delayTime.value = 0.1; window.__parleyDawTest.bus().connect(st.node) }
    else st.node = ctx.createGain()
    if (mode === 'hum') st.play(44101, 7, true)
    return st.node
  }
  st.play = (frames, seed, loop = false) => {
    const ctx = window.__parleyDawTest.context()
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate), d = buf.getChannelData(0)
    let s = seed >>> 0
    for (let i = 0; i < frames; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = s / 4294967296 - 0.5 }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop; src.connect(st.node); src.start()
  }
}

/** How long the 'hum' input is before it comes round: not a round number of anything a take is cut into. */
export const HUM = 44101
/**
 * A take of the 'hum' input, checked sample by sample: each must be the one that was playing at that moment. Where
 * in the round the take is, is read at its end; from there every sample has one right value. A piece of the take
 * lost, repeated or out of place puts what follows it somewhere else in the round, and it is `wrong`. `silent`: zeros
 * where the hum should be (what the browser did not hand to the recorder), and when the last of them is.
 */
export function humCheck(x, rate = 48000) {
  const want = noise(HUM, 7).map(as24), tail = x.length - 4000
  let phase = -1
  if (tail > 0) for (let p = 0; p < HUM && phase < 0; p++) { let same = true; for (let i = 0; i < 64 && same; i++) same = x[tail + i] === want[(p + i) % HUM]; if (same) phase = (((p - tail) % HUM) + HUM) % HUM }
  let wrong = 0, silent = 0, last = -1
  if (phase >= 0) for (let i = 0; i < x.length; i++) { if (x[i] === want[(phase + i) % HUM]) continue; if (x[i] === 0) { silent++; last = i } else wrong++ }
  return { frames: x.length, phase, wrong, silent, last_silent_ms: Math.round((last * 100000) / rate) / 100 }
}

// ---- a microphone the test plays into ------------------------------------------------------------------------

/**
 * For `context.addInitScript(syntheticMic)`: replaces the page's microphone with a stream the test controls. Whatever
 * `window.__parleyTestMic.feed(stream)` is given comes out of getUserMedia (silence until then), so a take can be a
 * known signal instead of the browser's fake beep. Only the test page is changed.
 */
export function syntheticMic() {
  let ctx = null, dest = null
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000 })
      dest = ctx.createMediaStreamDestination()
      // A stream with nothing connected never starts: keep a silent source running into it.
      const quiet = ctx.createConstantSource(); const zero = ctx.createGain(); zero.gain.value = 0; quiet.connect(zero).connect(dest); quiet.start()
    }
    return { ctx, dest }
  }
  const asked = []
  window.__parleyTestMic = {
    asked,
    context: () => ensure().ctx,
    /** Play `stream` into the microphone, `delayMs` late and at `gain`. Returns a function that stops it. */
    feed(stream, delayMs = 0, gain = 1) {
      const { ctx, dest } = ensure()
      const src = ctx.createMediaStreamSource(stream), d = ctx.createDelay(2), g = ctx.createGain()
      d.delayTime.value = delayMs / 1000; g.gain.value = gain
      src.connect(d).connect(g).connect(dest)
      return () => { src.disconnect(); g.disconnect() }
    },
    /** Play samples (mono floats at 48 kHz) into the microphone now. */
    play(samples) {
      const { ctx, dest } = ensure()
      const buf = ctx.createBuffer(1, samples.length, 48000); buf.copyToChannel(Float32Array.from(samples), 0)
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start()
    },
  }
  const md = navigator.mediaDevices
  const real = md.getUserMedia.bind(md)
  md.getUserMedia = async (c) => {
    asked.push(JSON.parse(JSON.stringify(c ?? null)))
    if (!c || !c.audio || c.video) return real(c)
    const { ctx, dest } = ensure()
    await ctx.resume().catch(() => {})
    return dest.stream.clone()
  }
}

// ---- what is playing -----------------------------------------------------------------------------------------

/**
 * Start capturing what the DAW plays (its master, as `tap()` hears it) sample for sample, by a processor on the audio
 * thread. `stopCapture` gives the samples back, with the blocks the browser never ran (`skipped`, in frames).
 */
export const startCapture = (page) => page.evaluate(async () => {
  const t = window.__parleyDawTest, ctx = t.context()
  if (!window.__cap) {
    const src = `registerProcessor('test-capture', class extends AudioWorkletProcessor { process(i) { const c = i[0]; this.port.postMessage([currentFrame, c[0] ? c[0].slice() : null, c[1] ? c[1].slice() : null]); return true } })`
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    const node = new AudioWorkletNode(ctx, 'test-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' })
    t.bus().connect(node)
    window.__cap = { node, blocks: null }
    node.port.onmessage = (e) => window.__cap.blocks?.push(e.data)
  }
  await ctx.resume()
  window.__cap.blocks = []
})
export const stopCapture = async (page) => {
  const r = await page.evaluate(() => {
    const blocks = window.__cap.blocks; window.__cap.blocks = null
    if (!blocks.length) return null
    const first = blocks[0][0], n = blocks[blocks.length - 1][0] + 128 - first
    const ch = [new Float32Array(n), new Float32Array(n)]
    let skipped = 0, next = first
    for (const [at, l, r] of blocks) { skipped += at - next; next = at + 128; if (l) ch[0].set(l, at - first); if (r ?? l) ch[1].set(r ?? l, at - first) }
    const b64 = (f) => { const u = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s) }
    return { rate: window.__parleyDawTest.context().sampleRate, frames: n, channels: ch.map(b64), skipped }
  })
  return r && { ...unpack(r), skipped: r.skipped }
}
