/** What `encodeWav` needs of an AudioBuffer. */
export type Pcm = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>

/**
 * A channel as 16-bit samples, dithered: before rounding, each sample gets triangular noise of one step either way
 * (TPDF), so what the rounding takes away is a steady hiss far below the music instead of distortion that follows
 * it. The noise comes from `seed`: the same audio always gives the same samples.
 */
export function to16(x: Float32Array, seed = 0): Int16Array {
  const out = new Int16Array(x.length)
  let s = (0x9e3779b9 ^ Math.imul(seed + 1, 0x85ebca6b)) >>> 0
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768 + next() - next())))
  return out
}

/** The largest sample of a buffer (1 = full scale): over 1, a file made of it clips. */
export function peakOf(buf: Pcm): number {
  let top = 0
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > top) top = a } }
  return top
}

/** PCM WAV from an AudioBuffer: 24-bit, or 16-bit with dither. What is over full scale is clipped. */
export function encodeWav(buf: Pcm, bits: 16 | 24 = 24): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate, bytes = bits / 8
  const out = new ArrayBuffer(44 + n * ch * bytes); const v = new DataView(out)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bytes, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * bytes, true); v.setUint16(32, ch * bytes, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, n * ch * bytes, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  if (bits === 16) {
    const q = chans.map((x, c) => to16(x, c))
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, q[c][i], true)
    return out
  }
  const b = new Uint8Array(out)
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-8388608, Math.min(8388607, Math.round(chans[c][i] * 8388608)))
    b[o++] = s & 0xff; b[o++] = (s >> 8) & 0xff; b[o++] = (s >> 16) & 0xff
  }
  return out
}

/** Samples (-1..1, interleaved) as 24-bit little-endian PCM: what a lossless take is sent and stored as. */
export function pcm24(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 3)
  for (let i = 0, o = 0; i < samples.length; i++) {
    const v = Math.max(-8388608, Math.min(8388607, Math.round(samples[i] * 8388608)))
    out[o++] = v & 0xff; out[o++] = (v >> 8) & 0xff; out[o++] = (v >> 16) & 0xff
  }
  return out
}
