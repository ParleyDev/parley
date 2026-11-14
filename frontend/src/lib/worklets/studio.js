// The studio's audio processors (AudioWorklet): take capture and the mixer's meter.
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
