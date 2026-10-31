import { useCallback, useEffect, useRef, useState } from 'react'
import { getToken } from './api'
import type { StudioSession, StudioTrack } from './types'

/** Peak buckets per second of audio for waveforms (20 ms each). */
export const PEAKS_PER_SECOND = 50

export type MixTrack = { track: StudioTrack; buffer: AudioBuffer; peaks: Float32Array; gain: number; mute: boolean; solo: boolean }

const audible = (trk: MixTrack, all: MixTrack[]) => !trk.mute && (!all.some((x) => x.solo) || trk.solo)

/** Max |sample| of every 20 ms window across all channels. */
function peaksOf(buf: AudioBuffer): Float32Array {
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

/**
 * Multitrack engine for a finished studio session: decodes every finished track, plays them aligned by offset from
 * any position with per-track gain / mute / solo, and renders a WAV mixdown offline. Shared by the sessions panel's
 * mixer and the engineer's console.
 */
export function useMultitrack(session: StudioSession | undefined) {
  const [tracks, setTracks] = useState<MixTrack[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const nodes = useRef<{ src: AudioBufferSourceNode; gain: GainNode }[]>([])
  const tracksRef = useRef<MixTrack[] | null>(null)
  const raf = useRef(0)
  const sessionId = session?.id
  tracksRef.current = tracks
  const length = tracks ? Math.max(0, ...tracks.map((trk) => trk.track.offset_ms / 1000 + trk.buffer.duration)) : 0

  const stop = useCallback(() => {
    nodes.current.forEach((n) => { try { n.src.stop() } catch { /* already stopped */ } })
    nodes.current = []; cancelAnimationFrame(raf.current); setPlaying(false)
  }, [])

  // A different take: drop the decoded audio.
  useEffect(() => { stop(); setTracks(null); setPos(0); setError(null) }, [sessionId, stop])
  useEffect(() => () => { stop(); ctxRef.current?.close().catch(() => {}) }, [stop])

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
        out.push({ track: trk, buffer, peaks: peaksOf(buffer), gain: 1, mute: false, solo: false })
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
    const end = Math.max(0, ...all.map((trk) => trk.track.offset_ms / 1000 + trk.buffer.duration))
    const start = from >= end ? 0 : Math.max(0, from)
    const t0 = ctx.currentTime + 0.05
    nodes.current = all.map((trk) => {
      const src = ctx.createBufferSource(); src.buffer = trk.buffer
      const gain = ctx.createGain(); gain.gain.value = audible(trk, all) ? trk.gain : 0
      src.connect(gain).connect(ctx.destination)
      const at = trk.track.offset_ms / 1000 - start
      if (at >= 0) src.start(t0 + at); else if (-at < trk.buffer.duration) src.start(t0, -at)
      return { src, gain }
    })
    setPlaying(true)
    const tick = () => { const p = start + ctx.currentTime - t0; setPos(Math.max(start, p)); if (p >= end) { stop(); setPos(0); return } raf.current = requestAnimationFrame(tick) }
    raf.current = requestAnimationFrame(tick)
  }, [stop])

  /** Move the playhead; keeps playing from there if it was. */
  const seek = useCallback((to: number) => { const p = Math.max(0, to); setPos(p); if (nodes.current.length) play(p) }, [play])

  const update = useCallback((i: number, patch: Partial<Pick<MixTrack, 'gain' | 'mute' | 'solo'>>) => setTracks((cur) => {
    if (!cur) return cur
    const next = cur.map((trk, j) => (j === i ? { ...trk, ...patch } : trk))
    nodes.current.forEach((n, j) => { n.gain.gain.value = audible(next[j], next) ? next[j].gain : 0 })
    return next
  }), [])

  const exportWav = useCallback(async () => {
    const all = tracksRef.current
    if (!all?.length || !session) return
    const rate = 48000
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(length * rate)), rate)
    for (const trk of all) { if (!audible(trk, all)) continue; const src = off.createBufferSource(); src.buffer = trk.buffer; const g = off.createGain(); g.gain.value = trk.gain; src.connect(g).connect(off.destination); src.start(trk.track.offset_ms / 1000) }
    const wav = encodeWav(await off.startRendering())
    ;(window as unknown as { __parleyMix?: Record<string, unknown> }).__parleyMix = { ...((window as unknown as { __parleyMix?: Record<string, unknown> }).__parleyMix ?? {}), exportedBytes: wav.byteLength }
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    const a = document.createElement('a'); a.href = url; a.download = `${session.name} - mix.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [session, length])

  return { tracks, loading, error, playing, pos, length, load, play, stop, seek, update, exportWav, audible: (trk: MixTrack) => (tracks ? audible(trk, tracks) : true) }
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
