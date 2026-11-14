import { describe, expect, it } from 'vitest'
import { encodeWav, pcm24, peakOf, to16, type Pcm } from './wav'

const pcm = (rate: number, ...chans: number[][]): Pcm => ({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: rate, getChannelData: (c: number) => Float32Array.from(chans[c]) as Float32Array<ArrayBuffer> })
const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

const i24 = (v: DataView, o: number) => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16)) << 8) >> 8

describe('encodeWav', () => {
  it('writes a 24-bit PCM header unless asked for 16', () => {
    const out = encodeWav(pcm(48000, [0, 0, 0], [0, 0, 0])), v = new DataView(out)
    expect(out.byteLength).toBe(44 + 3 * 2 * 3)
    expect([tag(v, 0), tag(v, 8), tag(v, 12), tag(v, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(v.getUint32(4, true)).toBe(out.byteLength - 8)
    expect(v.getUint32(16, true)).toBe(16)
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(48000 * 6)
    expect(v.getUint16(32, true)).toBe(6)
    expect(v.getUint16(34, true)).toBe(24)
    expect(v.getUint32(40, true)).toBe(18)
    const w = new DataView(encodeWav(pcm(48000, [0, 0, 0], [0, 0, 0]), 16))
    expect([w.byteLength, w.getUint32(28, true), w.getUint16(32, true), w.getUint16(34, true), w.getUint32(40, true)]).toEqual([44 + 12, 48000 * 4, 4, 16, 12])
  })
  it('interleaves the channels, each sample rounded to 24 bits', () => {
    const v = new DataView(encodeWav(pcm(44100, [0.5, -0.5], [0.25, -0.25])))
    expect(v.getUint32(24, true)).toBe(44100)
    expect([0, 1, 2, 3].map((i) => i24(v, 44 + i * 3))).toEqual([4194304, 2097152, -4194304, -2097152])
  })
  it('reaches full scale and clips what is over it', () => {
    const v = new DataView(encodeWav(pcm(48000, [1, -1, 1.7, -3, 0])))
    expect(v.getUint16(22, true)).toBe(1)
    expect([0, 1, 2, 3, 4].map((i) => i24(v, 44 + i * 3))).toEqual([8388607, -8388608, 8388607, -8388608, 0])
    const w = new DataView(encodeWav(pcm(48000, [1.7, -3]), 16))
    expect([0, 1].map((i) => w.getInt16(44 + i * 2, true))).toEqual([32767, -32768])
  })
})

describe('to16', () => {
  const tone = (amp: number, n = 48000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / 48000))
  it('gives the same samples for the same audio, and other noise for another channel', () => {
    const x = tone(0.25, 4800)
    expect([...to16(x, 0)]).toEqual([...to16(x, 0)])
    expect([...to16(x, 0)]).not.toEqual([...to16(x, 1)])
  })
  it('is within a step and a half of what it was given, and right on average', () => {
    const x = tone(0.5), q = to16(x)
    let worst = 0, sum = 0
    for (let i = 0; i < x.length; i++) { const e = q[i] - x[i] * 32768; worst = Math.max(worst, Math.abs(e)); sum += e }
    expect(worst).toBeLessThanOrEqual(1.5)
    expect(Math.abs(sum / x.length)).toBeLessThan(0.02)
  })
  it('adds noise of half a step (rounding and dither together), whatever the signal', () => {
    for (const amp of [0, 0.001, 0.5]) {
      const x = tone(amp), q = to16(x)
      let sq = 0
      for (let i = 0; i < x.length; i++) sq += (q[i] - x[i] * 32768) ** 2
      expect(Math.sqrt(sq / x.length)).toBeGreaterThan(0.45)
      expect(Math.sqrt(sq / x.length)).toBeLessThan(0.55)
    }
  })
  it('keeps a tone smaller than one step, which rounding alone would lose', () => {
    // 0.4 of a step: rounded without dither, every sample is 0.
    const amp = 0.4 / 32768, x = tone(amp), q = to16(x)
    expect(x.every((v) => Math.round(v * 32768) === 0)).toBe(true)
    // The tone is still there at its level: what comes out, measured against the tone itself.
    let dot = 0, ref = 0
    for (let i = 0; i < x.length; i++) { dot += q[i] * x[i] * 32768; ref += (x[i] * 32768) ** 2 }
    expect(dot / ref).toBeGreaterThan(0.85)
    expect(dot / ref).toBeLessThan(1.15)
  })
})

describe('peakOf', () => {
  it('is the largest sample of any channel, either sign', () => {
    expect(peakOf(pcm(48000, [0.1, -0.2, 0.15], [0.05, 0.3, -1.25]))).toBeCloseTo(1.25, 6)
    expect(peakOf(pcm(48000, [0, 0]))).toBe(0)
  })
})

describe('pcm24', () => {
  const read = (b: Uint8Array, i: number) => ((b[i * 3] | (b[i * 3 + 1] << 8) | (b[i * 3 + 2] << 16)) << 8) >> 8
  it('writes three bytes a sample, little-endian', () => {
    const b = pcm24(Float32Array.from([0.5, -0.5, 0, 1 / 8388608]))
    expect(b.length).toBe(12)
    expect([...b.subarray(0, 3)]).toEqual([0x00, 0x00, 0x40])
    expect([0, 1, 2, 3].map((i) => read(b, i))).toEqual([4194304, -4194304, 0, 1])
  })
  it('reaches full scale and clips what is over it', () => {
    const b = pcm24(Float32Array.from([1, -1, 1.7, -3]))
    expect([0, 1, 2, 3].map((i) => read(b, i))).toEqual([8388607, -8388608, 8388607, -8388608])
  })
  it('is within half a step of what it was given', () => {
    const x = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.37) * 0.9), b = pcm24(x)
    let worst = 0
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(read(b, i) / 8388608 - x[i]))
    expect(worst).toBeLessThanOrEqual(0.5 / 8388608 + 1e-9)
  })
})
