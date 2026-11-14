import { describe, expect, it } from 'vitest'
import { encodeWav, type Pcm } from './wav'

const pcm = (rate: number, ...chans: number[][]): Pcm => ({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: rate, getChannelData: (c: number) => Float32Array.from(chans[c]) as Float32Array<ArrayBuffer> })
const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

describe('encodeWav', () => {
  it('writes a 16-bit PCM header', () => {
    const out = encodeWav(pcm(48000, [0, 0, 0], [0, 0, 0])), v = new DataView(out)
    expect(out.byteLength).toBe(44 + 3 * 2 * 2)
    expect([tag(v, 0), tag(v, 8), tag(v, 12), tag(v, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(v.getUint32(4, true)).toBe(out.byteLength - 8)
    expect(v.getUint32(16, true)).toBe(16)
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(48000 * 4)
    expect(v.getUint16(32, true)).toBe(4)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(12)
  })
  it('interleaves the channels', () => {
    const v = new DataView(encodeWav(pcm(44100, [0.5, -0.5], [0.25, -0.25])))
    expect(v.getUint32(24, true)).toBe(44100)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([16383, 8191, -16384, -8192])
  })
  it('reaches full scale and clips what is over it', () => {
    const v = new DataView(encodeWav(pcm(48000, [1, -1, 1.7, -3, 0])))
    expect(v.getUint16(22, true)).toBe(1)
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, -32768, 0])
  })
})
