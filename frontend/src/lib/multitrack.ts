import { useCallback, useEffect, useRef, useState } from 'react'
import { getToken } from './api'
import type { StudioSession, StudioTrack } from './types'

/** Peak buckets per second of audio for waveforms (20 ms each). */
export const PEAKS_PER_SECOND = 50

export type MixTrack = { track: StudioTrack; buffer: AudioBuffer; peaks: Float32Array }
/** One lane of the mix (a band member: all their clips in the take). Gain is linear, 0..1.5; pan -1..1. */
export type LaneMix = { gain: number; pan: number; mute: boolean; solo: boolean }
export const DEFAULT_MIX: LaneMix = { gain: 1, pan: 0, mute: false, solo: false }
/** Clips belong to their member's lane (a removed account keeps a lane of its own). */
export const laneKey = (tr: StudioTrack) => tr.user_id ?? tr.id
export const laneMix = (mix: Record<string, LaneMix>, key: string) => mix[key] ?? DEFAULT_MIX
const audibleIn = (mix: Record<string, LaneMix>, keys: string[], key: string) => { const m = laneMix(mix, key); return !m.mute && (!keys.some((k) => laneMix(mix, k).solo) || m.solo) }

/** One metronome click at `when` (the console's playback and the band's live click share it). */
export function clickAt(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean, countIn = false) {
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

/** RMS of an analyser's current window, scaled to a 0..1 meter. */
function meter(a: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  a.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.6)
}

type Bus = { gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode }

/**
 * Multitrack engine for a finished studio session: decodes every finished clip and plays them aligned by offset
 * (negative offsets are count-in pre-roll) from any position. Each member's clips run through a lane bus (gain, pan,
 * meter) into a master bus; mute / solo / gain / pan follow `mix` live. With `click`, the take's tempo clicks along.
 * Renders a WAV mixdown offline. Shared by the sessions panel's mixer and the engineer's console.
 */
export function useMultitrack(session: StudioSession | undefined, mix: Record<string, LaneMix> = {}, master = 1, click = false) {
  const [tracks, setTracks] = useState<MixTrack[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const sources = useRef<AudioBufferSourceNode[]>([])
  const buses = useRef(new Map<string, Bus>())
  const masterBus = useRef<{ gain: GainNode; analyser: AnalyserNode } | null>(null)
  const clickTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const tracksRef = useRef<MixTrack[] | null>(null)
  const mixRef = useRef({ mix, master, click })
  const raf = useRef(0)
  const meterBuf = useRef(new Float32Array(1024))
  const sessionId = session?.id
  tracksRef.current = tracks
  mixRef.current = { mix, master, click }
  const keys = tracks ? [...new Set(tracks.map((x) => laneKey(x.track)))] : []
  const start = tracks ? Math.min(0, ...tracks.map((x) => x.track.offset_ms / 1000)) : 0
  const length = tracks ? Math.max(0, ...tracks.map((x) => x.track.offset_ms / 1000 + x.buffer.duration)) : 0

  const stop = useCallback(() => {
    sources.current.forEach((n) => { try { n.stop() } catch { /* already stopped */ } })
    sources.current = []
    buses.current.forEach((b) => { b.gain.disconnect(); b.pan.disconnect(); b.analyser.disconnect() }); buses.current.clear()
    masterBus.current?.gain.disconnect(); masterBus.current?.analyser.disconnect(); masterBus.current = null
    if (clickTimer.current) clearInterval(clickTimer.current); clickTimer.current = null
    cancelAnimationFrame(raf.current); setPlaying(false)
  }, [])

  // A different take: drop the decoded audio.
  useEffect(() => { stop(); setTracks(null); setPos(0); setError(null) }, [sessionId, stop])
  useEffect(() => () => { stop(); ctxRef.current?.close().catch(() => {}) }, [stop])

  // Mix changes apply to what is playing.
  useEffect(() => {
    const ks = [...buses.current.keys()]
    buses.current.forEach((b, k) => { const m = laneMix(mix, k); b.gain.gain.value = audibleIn(mix, ks, k) ? m.gain : 0; b.pan.pan.value = m.pan })
    if (masterBus.current) masterBus.current.gain.gain.value = master
  }, [mix, master])

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true); setError(null)
    try {
      const ctx = (ctxRef.current ??= new AudioContext())
      const token = getToken()
      const out: MixTrack[] = []
      for (const trk of session.tracks.filter((trk) => trk.done && trk.size > 0)) {
        const r = await fetch(trk.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!r.ok) throw new Error(`${trk.display_name}: ${r.status}`)
        const buffer = await ctx.decodeAudioData(await r.arrayBuffer())
        out.push({ track: trk, buffer, peaks: peaksOf(buffer) })
      }
      setTracks(out)
      ;(window as unknown as { __parleyMix?: unknown }).__parleyMix = { tracks: out.length, seconds: Math.max(0, ...out.map((trk) => trk.buffer.duration)) }
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [session])

  const play = useCallback((from = 0) => {
    const all = tracksRef.current, ctx = ctxRef.current
    if (!all || !ctx) return
    ctx.resume().catch(() => {})
    stop()
    const { mix: m, master: mg } = mixRef.current
    const first = Math.min(0, ...all.map((x) => x.track.offset_ms / 1000))
    const end = Math.max(0, ...all.map((x) => x.track.offset_ms / 1000 + x.buffer.duration))
    const begin = from >= end ? first : Math.max(first, from)
    const t0 = ctx.currentTime + 0.05
    const mGain = ctx.createGain(); mGain.gain.value = mg
    const mAn = ctx.createAnalyser(); mAn.fftSize = 1024
    mGain.connect(mAn).connect(ctx.destination)
    masterBus.current = { gain: mGain, analyser: mAn }
    const ks = [...new Set(all.map((x) => laneKey(x.track)))]
    for (const k of ks) {
      const lm = laneMix(m, k)
      const gain = ctx.createGain(); gain.gain.value = audibleIn(m, ks, k) ? lm.gain : 0
      const pan = ctx.createStereoPanner(); pan.pan.value = lm.pan
      const analyser = ctx.createAnalyser(); analyser.fftSize = 1024
      gain.connect(pan).connect(analyser).connect(mGain)
      buses.current.set(k, { gain, pan, analyser })
    }
    sources.current = all.map((trk) => {
      const src = ctx.createBufferSource(); src.buffer = trk.buffer
      src.connect(buses.current.get(laneKey(trk.track))!.gain)
      const at = trk.track.offset_ms / 1000 - begin
      if (at >= 0) src.start(t0 + at); else if (-at < trk.buffer.duration) src.start(t0, -at)
      return src
    })
    // The take's tempo, clicking along while the console's metronome is on.
    if (session && session.bpm > 0) {
      const beat = 60 / session.bpm, beats = session.beats || 4
      let n = Math.ceil(begin / beat)
      const tick = () => {
        const now = ctx.currentTime - t0 + begin
        while (n * beat < now + 0.12 && n * beat < end) {
          if (mixRef.current.click && n * beat >= now - 0.01) clickAt(ctx, ctx.destination, t0 + n * beat - begin, ((n % beats) + beats) % beats === 0, n < 0)
          n++
        }
      }
      tick(); clickTimer.current = setInterval(tick, 25)
    }
    setPlaying(true)
    const frame = () => { const p = begin + ctx.currentTime - t0; setPos(Math.max(begin, p)); if (p >= end) { stop(); setPos(0); return } raf.current = requestAnimationFrame(frame) }
    raf.current = requestAnimationFrame(frame)
  }, [stop, session])

  /** Move the playhead; keeps playing from there if it was. */
  const seek = useCallback((to: number) => { setPos(to); if (sources.current.length) play(to) }, [play])

  /** Playback level 0..1 of a lane, or of the master bus with 'master' (0 when stopped). */
  const level = useCallback((key: string) => {
    const a = key === 'master' ? masterBus.current?.analyser : buses.current.get(key)?.analyser
    return a ? meter(a, meterBuf.current) : 0
  }, [])

  const exportWav = useCallback(async () => {
    const all = tracksRef.current
    if (!all?.length || !session) return
    const { mix: m, master: mg } = mixRef.current
    const ks = [...new Set(all.map((x) => laneKey(x.track)))]
    const rate = 48000
    const first = Math.min(0, ...all.map((x) => x.track.offset_ms / 1000))
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil((length - first) * rate)), rate)
    const out = off.createGain(); out.gain.value = mg; out.connect(off.destination)
    for (const k of ks) {
      if (!audibleIn(m, ks, k)) continue
      const lm = laneMix(m, k)
      const g = off.createGain(); g.gain.value = lm.gain
      const p = off.createStereoPanner(); p.pan.value = lm.pan
      g.connect(p).connect(out)
      for (const trk of all.filter((x) => laneKey(x.track) === k)) { const src = off.createBufferSource(); src.buffer = trk.buffer; src.connect(g); src.start(trk.track.offset_ms / 1000 - first) }
    }
    const wav = encodeWav(await off.startRendering())
    ;(window as unknown as { __parleyMix?: Record<string, unknown> }).__parleyMix = { ...((window as unknown as { __parleyMix?: Record<string, unknown> }).__parleyMix ?? {}), exportedBytes: wav.byteLength }
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    const a = document.createElement('a'); a.href = url; a.download = `${session.name} - mix.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [session, length])

  return { tracks, keys, loading, error, playing, pos, start, length, load, play, stop, seek, level, exportWav, audible: (key: string) => audibleIn(mix, keys.length ? keys : [key], key) }
}

/** 16-bit PCM WAV from an AudioBuffer. */
export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate
  const out = new ArrayBuffer(44 + n * ch * 2); const v = new DataView(out)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2 }
  return out
}
