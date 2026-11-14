// The studio's audio processors (AudioWorklet): take capture, the mixer's meter, and the limiter and gate effects.
//
// Take capture: hands the samples arriving at its input to the page, uncompressed and
// uninterrupted, a few thousand frames at a time, each batch with the context frame its first sample was captured
// at. The recorder (lib/studio.ts) places the take from that frame and tells its length from the frames it got.
// The batches' buffers go round: the recorder hands each back once it has read it, so that a take allocates next to
// nothing on the audio thread, where a pause to collect garbage costs samples.
// Plain JavaScript: the browser loads this file as it is.
const BATCH = 4096

class TakeCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = options?.processorOptions?.channels === 2 ? 2 : 1
    this.buf = new Float32Array(BATCH * this.channels)
    this.fill = 0
    this.first = 0
    this.calls = 0
    this.done = false
    this.spare = []
    this.port.onmessage = (e) => {
      if (e.data?.spare) { if (this.spare.length < 8 && e.data.spare.length === this.buf.length) this.spare.push(e.data.spare); return }
      if (e.data !== 'stop' || this.done) return
      this.send()
      this.done = true
      this.port.postMessage({ end: true })
    }
  }

  send() {
    if (!this.fill) return
    const samples = this.buf
    this.buf = this.spare.pop() ?? new Float32Array(samples.length)
    this.port.postMessage({ frame: this.first, samples, frames: this.fill }, [samples.buffer])
    this.fill = 0
  }

  process(inputs) {
    if (this.done) return false
    const input = inputs[0] ?? []
    const n = input[0]?.length ?? 128
    // The first time it is run a processor may be told the frame of the device buffer before (measured in Chrome
    // against a source started at a known frame: the audio goes on unbroken, only that first number is behind).
    // The second number is the true one, and the first block is the one before it.
    // eslint-disable-next-line no-undef
    if (++this.calls === 2 && this.fill) this.first = currentFrame - this.fill
    // A batch is frames that follow one another: when the clock is not where the last frame left it, the next
    // batch begins at the clock.
    // eslint-disable-next-line no-undef
    if (this.fill + n > BATCH || currentFrame !== this.first + this.fill) this.send()
    // eslint-disable-next-line no-undef
    if (!this.fill) this.first = currentFrame
    const ch = this.channels, buf = this.buf
    let o = this.fill * ch
    // Nothing connected (or a source that has ended) is silence: the take keeps its time.
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const d = input[c] ?? input[0]; buf[o++] = d ? d[i] : 0 }
    this.fill += n
    return true
  }
}

registerProcessor('parley-take-capture', TakeCapture)

// The meter: one input per mixer strip (and one for the master). Every sample of every input is looked at; about
// 47 times a second (at 48 kHz) the page is told, per input, the largest sample since the last report and the mean
// square of the loudest channel. A sample over full scale is reported in the block it happens in.
const REPORT = 1024

class Meter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const n = options?.numberOfInputs ?? 1
    this.peak = new Float32Array(n)
    this.sum = new Float64Array(n)
    this.over = new Uint8Array(n)
    this.frames = 0
    this.done = false
    this.port.onmessage = (e) => { if (e.data === 'stop') this.done = true }
  }

  process(inputs) {
    if (this.done) return false
    let len = 128, over = false
    for (let i = 0; i < this.peak.length; i++) {
      const input = inputs[i]
      if (!input) continue
      let peak = this.peak[i], most = 0
      for (let c = 0; c < input.length; c++) {
        const d = input[c]
        len = d.length
        let sum = 0
        for (let k = 0; k < d.length; k++) { const v = d[k], a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v }
        if (sum > most) most = sum
      }
      if (peak > 1 && !this.over[i]) { this.over[i] = 1; over = true }
      this.peak[i] = peak
      this.sum[i] += most
    }
    this.frames += len
    if (over || this.frames >= REPORT) {
      const peak = this.peak.slice(), ms = new Float32Array(peak.length)
      for (let i = 0; i < ms.length; i++) ms[i] = this.sum[i] / this.frames
      this.port.postMessage({ peak, ms, over: this.over.slice(), frames: this.frames })
      this.peak.fill(0); this.sum.fill(0); this.over.fill(0); this.frames = 0
    }
    return true
  }
}

registerProcessor('parley-meter', Meter)

// The dynamics effects that Web Audio's own nodes cannot do exactly. They run the same in the page's context and in
// the offline one a render uses. Their parameters are in the units the mixer shows (dB, ms), read once a block.
const lin = (db) => Math.pow(10, db / 20)
const param = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' })

// The limiter: it reads LOOK frames ahead of what it lets out, so the gain is already down when a peak arrives, and
// no sample leaves over the ceiling. The channels are turned down together. It delays its strip by LOOK frames.
const LOOK = 96

class Limiter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [param('ceiling', -1, -24, 0), param('release', 100, 10, 1000)] }
  constructor() {
    super()
    this.delay = [new Float32Array(LOOK), new Float32Array(LOOK)]
    this.at = 0
    // The gain each of the last frames asks for, falling at once and recovering at the release time.
    this.want = 1
    // The smallest of the last LOOK + 1 of them (a queue of candidates, oldest first), then their mean over LOOK.
    this.qv = new Float32Array(LOOK + 2); this.qi = new Float64Array(LOOK + 2); this.qh = 0; this.qn = 0
    this.box = new Float32Array(LOOK).fill(1); this.sum = LOOK; this.n = 0
    this.done = false
    this.port.onmessage = (e) => { if (e.data === 'stop') this.done = true }
  }

  process(inputs, outputs, params) {
    if (this.done) return false
    const input = inputs[0] ?? [], output = outputs[0]
    const frames = output[0].length, ch = Math.min(2, output.length)
    const ceil = lin(params.ceiling[0]), back = 1 - Math.exp(-1 / ((params.release[0] / 1000) * sampleRate)) // eslint-disable-line no-undef
    const Q = this.qv.length
    for (let i = 0; i < frames; i++) {
      let peak = 0
      for (let c = 0; c < ch; c++) { const v = input[c] ? input[c][i] : 0, a = v < 0 ? -v : v; if (a > peak) peak = a }
      const need = peak > ceil ? ceil / peak : 1
      this.want = Math.min(need, this.want + (1 - this.want) * back)
      // Smallest over the window: drop candidates that are no smaller than the new one, and the one that has left.
      while (this.qn && this.qv[(this.qh + this.qn - 1) % Q] >= this.want) this.qn--
      this.qv[(this.qh + this.qn) % Q] = this.want; this.qi[(this.qh + this.qn) % Q] = this.n; this.qn++
      if (this.qi[this.qh] < this.n - LOOK) { this.qh = (this.qh + 1) % Q; this.qn-- }
      const least = this.qv[this.qh]
      const k = this.n % LOOK
      this.sum += least - this.box[k]; this.box[k] = least
      // The running sum drifts by rounding: counted afresh every so often.
      if (k === 0 && this.n % (LOOK * 512) === 0) { let s = 0; for (let j = 0; j < LOOK; j++) s += this.box[j]; this.sum = s }
      const gain = this.sum / LOOK
      for (let c = 0; c < ch; c++) {
        const d = this.delay[c]
        let y = d[this.at] * gain
        if (y > ceil) y = ceil; else if (y < -ceil) y = -ceil
        output[c][i] = y
        d[this.at] = input[c] ? input[c][i] : 0
      }
      this.at = (this.at + 1) % LOOK
      this.n++
    }
    return true
  }
}

registerProcessor('parley-limiter', Limiter)

// The gate: closed (turned down by `range`) until the signal passes the threshold, open while it stays above and
// for `hold` after, then closing over `release`. It closes 3 dB under where it opens, so a level at the threshold
// does not chatter. The channels open together. No delay.
class Gate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [param('threshold', -45, -80, 0), param('attack', 1, 0.1, 50), param('hold', 50, 0, 500), param('release', 150, 5, 2000), param('range', -80, -80, 0)] }
  constructor() {
    super()
    this.env = 0; this.open = false; this.held = 0; this.gain = 0; this.started = false
    this.done = false
    this.port.onmessage = (e) => { if (e.data === 'stop') this.done = true }
  }

  process(inputs, outputs, params) {
    if (this.done) return false
    const input = inputs[0] ?? [], output = outputs[0]
    const frames = output[0].length, ch = output.length
    const rate = sampleRate // eslint-disable-line no-undef
    const thr = lin(params.threshold[0]), shut = thr * 0.708, floor = params.range[0] <= -80 ? 0 : lin(params.range[0])
    const up = 1 - Math.exp(-1 / ((params.attack[0] / 1000) * rate)), down = 1 - Math.exp(-1 / ((params.release[0] / 1000) * rate))
    const hold = (params.hold[0] / 1000) * rate, fall = Math.exp(-1 / (0.005 * rate))
    if (!this.started) { this.started = true; this.gain = floor }
    for (let i = 0; i < frames; i++) {
      let peak = 0
      for (let c = 0; c < ch; c++) { const v = input[c] ? input[c][i] : 0, a = v < 0 ? -v : v; if (a > peak) peak = a }
      this.env = peak > this.env ? peak : this.env * fall
      if (this.env > thr) { this.open = true; this.held = hold } else if (this.env < shut && this.open) { if (this.held > 0) this.held--; else this.open = false }
      this.gain += this.open ? (1 - this.gain) * up : (floor - this.gain) * down
      for (let c = 0; c < ch; c++) output[c][i] = input[c] ? input[c][i] * this.gain : 0
    }
    return true
  }
}

registerProcessor('parley-gate', Gate)
