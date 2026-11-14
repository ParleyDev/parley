/** What `encodeWav` needs of an AudioBuffer. */
export type Pcm = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>

/** 16-bit PCM WAV from an AudioBuffer. */
export function encodeWav(buf: Pcm): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate
  const out = new ArrayBuffer(44 + n * ch * 2); const v = new DataView(out)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2 }
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
