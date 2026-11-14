// Studio take capture (AudioWorklet): hands the samples arriving at its input to the page, uncompressed and
// uninterrupted, a few thousand frames at a time, each batch with the context frame its first sample was captured
// at. The recorder (lib/studio.ts) places the take from that frame and tells its length from the frames it got.
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
    this.port.onmessage = (e) => {
      if (e.data !== 'stop' || this.done) return
      this.send()
      this.done = true
      this.port.postMessage({ end: true })
    }
  }

  send() {
    if (!this.fill) return
    const samples = this.buf.slice(0, this.fill * this.channels)
    this.port.postMessage({ frame: this.first, samples }, [samples.buffer])
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
