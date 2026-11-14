import { encodeWav } from './wav'

/** Peak buckets per second of audio for waveforms (20 ms each). */
export const PEAKS_PER_SECOND = 50

let clicks = 0
/** How many clicks have been played (for tests). */
export const clicksPlayed = () => clicks

/** One metronome click at `when` (the console's playback and the band's live click share it). */
export function clickAt(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean, countIn = false) {
  clicks++
  const osc = ctx.createOscillator(), env = ctx.createGain()
  osc.frequency.value = accent ? 1600 : countIn ? 1200 : 1000
  env.gain.setValueAtTime(0.0001, when)
  env.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.35, when + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  osc.connect(env).connect(dest)
  osc.start(when); osc.stop(when + 0.06)
}

/** Max |sample| of every 20 ms window across all channels. */
export function peaksOf(buf: AudioBuffer): Float32Array {
  const size = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SECOND))
  const out = new Float32Array(Math.ceil(buf.length / size))
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) {
      let m = out[i]
      for (let j = i * size, end = Math.min(d.length, j + size); j < end; j++) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > m) m = v }
      out[i] = m
    }
  }
  return out
}

export { encodeWav }
