import { useEffect, useRef } from 'react'
import { analyser, currentTime, timeline } from '../lib/player'

export type VizMode = 'bars' | 'wave' | 'orb'
/** The spectrum the drawing works in: 128 points, log-spaced from 40 Hz (low notes get as much room as high ones). */
const BINS = 128
const LO_HZ = 40, HI_HZ = 10500
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
/** A theme colour as [r, g, b] (the canvas normalises any CSS colour to #rrggbb). */
function rgbOf(color: string): [number, number, number] {
  const g = document.createElement('canvas').getContext('2d')
  if (!g) return [109, 93, 252]
  g.fillStyle = '#6d5dfc'; g.fillStyle = color
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(g.fillStyle))
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
  const n = String(g.fillStyle).match(/[\d.]+/g)?.map(Number) ?? []
  return n.length >= 3 ? [n[0], n[1], n[2]] : [109, 93, 252]
}
const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`
const lighten = ([r, g, b]: [number, number, number], k: number) => `rgb(${Math.round(r + (255 - r) * k)}, ${Math.round(g + (255 - g) * k)}, ${Math.round(b + (255 - b) * k)})`

/**
 * The audio player's visualisation in the theme's accent: mirrored frequency bars with falling peaks, a glowing
 * waveform, or a pulsing orb. It follows the server's timeline for the track (lib/player Viz) in step with the
 * playhead, which reacts to the music on every platform, iPhones in the background included; until that arrives it
 * reads the live analyser where there is one, else a gentle synthetic motion. It settles to a resting line when paused
 * and stops drawing once still. Reduced motion draws at a few frames a second.
 */
export default function AudioVisualizer({ mode, active, playing, className = '' }: { mode: VizMode; active: boolean; playing: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ active, playing, mode })
  live.current = { active, playing, mode }
  const kick = useRef<() => void>(() => {})

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const level = new Float32Array(BINS), peak = new Float32Array(BINS), wave = new Float32Array(BINS)
    let freq = new Uint8Array(0), time = new Uint8Array(0), logBin = new Float32Array(BINS), binsFor = 0
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, last = 0, frame = 0
    let A: [number, number, number] = [109, 93, 252], D: [number, number, number] = [148, 155, 164], accent = ''
    const loop = (now: number) => {
      raf = 0
      if (slow && now - last < 160) { raf = requestAnimationFrame(loop); return }
      last = now
      if (frame++ % 60 === 0) { A = rgbOf(css('--color-accent', '#6d5dfc')); D = rgbOf(css('--color-text-2', '#949ba4')); accent = rgba(A, 1) }
      const { active, playing, mode } = live.current
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      // Targets: the server's timeline, else the live analyser, else a synthetic motion; silence when paused.
      const tl = active && playing ? timeline() : null
      const an = !tl && active && playing ? analyser() : null
      if (an) {
        if (freq.length !== an.frequencyBinCount) { freq = new Uint8Array(an.frequencyBinCount); time = new Uint8Array(an.fftSize) }
        if (binsFor !== an.context.sampleRate) {
          binsFor = an.context.sampleRate
          const hz = binsFor / an.fftSize
          for (let i = 0; i < BINS; i++) logBin[i] = Math.min(freq.length - 1, (LO_HZ * (HI_HZ / LO_HZ) ** (i / (BINS - 1))) / hz)
        }
        an.getByteFrequencyData(freq); an.getByteTimeDomainData(time)
      }
      const source = tl ? 'timeline' : an ? 'live' : active && playing ? 'synthetic' : 'idle'
      if (cv.dataset.source !== source) cv.dataset.source = source
      let f0 = 0, f1 = 0, fk = 0
      if (tl) { const f = Math.max(0, (currentTime() - tl.offset) * tl.fps); f0 = Math.min(tl.frames - 1, Math.floor(f)); f1 = Math.min(tl.frames - 1, f0 + 1); fk = f - Math.floor(f) }
      const t = now / 1000
      let energy = 0
      for (let i = 0; i < BINS; i++) {
        let f = 0, tw = 0
        if (tl) {
          // Between two frames and two bands.
          const x = (i / (BINS - 1)) * (tl.bands - 1), j = Math.floor(x), jk = x - j, j2 = Math.min(tl.bands - 1, j + 1)
          const at = (fr: number) => (tl.data[fr * tl.bands + j] * (1 - jk) + tl.data[fr * tl.bands + j2] * jk) / 255
          f = at(f0) * (1 - fk) + at(f1) * fk
          // No samples to draw a waveform from: a few partials sized by the low, mid and high bands.
          const low = level[8], mid = level[48], high = level[96]
          tw = (low * Math.sin(t * 5 + i * 0.09) + mid * 0.6 * Math.sin(t * 9 + i * 0.31) + high * 0.35 * Math.sin(t * 15 + i * 0.83)) * 0.75
        } else if (an) {
          const p = logBin[i], k = Math.floor(p), r = p - k
          f = (freq[k] * (1 - r) + (freq[Math.min(freq.length - 1, k + 1)] ?? 0) * r) / 255
          tw = (time[Math.floor((i / BINS) * Math.min(time.length, 512))] - 128) / 128
        } else if (active && playing) {
          f = Math.max(0, (0.55 + 0.45 * Math.sin(t * 2.3 + i * 0.37) * Math.sin(t * 1.1 + i * 0.11)) * (1 - i / BINS) ** 1.4)
          tw = 0.45 * Math.sin(t * 6 + i * 0.18) * Math.sin(t * 1.7 + i * 0.05)
        }
        level[i] += (f - level[i]) * (f > level[i] ? 0.5 : 0.18)
        wave[i] += (tw - wave[i]) * 0.35
        peak[i] = Math.max(level[i], peak[i] - 0.012)
        energy += level[i] + Math.abs(wave[i])
      }

      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, accent); grad.addColorStop(0.5, accent); grad.addColorStop(1, rgba(A, 0.35))
      const mid = h / 2
      if (mode === 'bars') {
        const n = Math.max(4, Math.min(56, Math.floor(w / 7)))
        const slot = w / n, bw = Math.max(2, slot * 0.58)
        for (let b = 0; b < n; b++) {
          const i = Math.min(BINS - 1, Math.floor(((b + 0.5) / n) * BINS))
          const v = level[i], bh = Math.max(3, v * (h - 6))
          const x = b * slot + (slot - bw) / 2
          g.fillStyle = v > 0.02 ? grad : rgba(D, 0.45)
          g.beginPath(); g.roundRect(x, mid - bh / 2, bw, bh, bw / 2); g.fill()
          if (peak[i] > 0.05) { g.fillStyle = accent; g.globalAlpha = 0.7; g.fillRect(x, mid - (peak[i] * (h - 6)) / 2 - 3, bw, 1.5); g.fillRect(x, mid + (peak[i] * (h - 6)) / 2 + 1.5, bw, 1.5); g.globalAlpha = 1 }
        }
      } else if (mode === 'wave') {
        for (const [alpha, scale, width] of [[0.25, 1.35, 6], [1, 1, 2.25]] as const) {
          g.beginPath()
          for (let i = 0; i < BINS; i++) {
            const x = (i / (BINS - 1)) * w
            const env = Math.sin((i / (BINS - 1)) * Math.PI) // pinned at both ends
            const y = mid + wave[i] * env * (h / 2 - 4) * scale
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
          }
          g.strokeStyle = energy > 0.5 ? accent : rgba(D, 0.6)
          g.globalAlpha = alpha; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'
          g.shadowColor = accent; g.shadowBlur = alpha === 1 ? 8 : 0
          g.stroke()
        }
        g.globalAlpha = 1; g.shadowBlur = 0
      } else {
        // A glowing orb that swells with the bass, the spectrum fanning out from it to both edges.
        let bass = 0
        for (let i = 4; i < 28; i++) bass += level[i] / 24
        const cx = w / 2, r = h * 0.26 + bass * h * 0.12
        const glow = g.createRadialGradient(cx, mid, r * 0.5, cx, mid, r * 3)
        glow.addColorStop(0, rgba(A, 0.2 + bass * 0.45)); glow.addColorStop(1, rgba(A, 0))
        g.fillStyle = glow; g.fillRect(0, 0, w, h)
        const span = cx - r - 6, n = Math.max(6, Math.floor(span / 5))
        g.lineCap = 'round'; g.lineWidth = 2.5
        for (let k = 0; k < n; k++) {
          const i = Math.min(BINS - 1, Math.floor((k / n) * BINS))
          const v = level[i], len = Math.max(1.5, v * (h - 8) * 0.5), off = r + 8 + (k / n) * span
          g.strokeStyle = rgba(A, (0.25 + v * 0.75) * (1 - (k / n) * 0.6))
          for (const x of [cx - off, cx + off]) { g.beginPath(); g.moveTo(x, mid - len); g.lineTo(x, mid + len); g.stroke() }
        }
        g.strokeStyle = rgba(A, 0.25 + bass * 0.5); g.lineWidth = 1.5
        g.beginPath(); g.arc(cx, mid, r + 3 + bass * 4, 0, Math.PI * 2); g.stroke()
        const core = g.createRadialGradient(cx - r * 0.35, mid - r * 0.35, 0, cx, mid, r)
        core.addColorStop(0, lighten(A, 0.5)); core.addColorStop(1, accent)
        g.fillStyle = core; g.beginPath(); g.arc(cx, mid, r, 0, Math.PI * 2); g.fill()
      }
      // Keep going while there's sound or motion left to settle.
      if ((active && playing) || energy > 0.05) raf = requestAnimationFrame(loop)
    }
    kick.current = () => { if (!raf) raf = requestAnimationFrame(loop) }
    kick.current()
    const ro = new ResizeObserver(() => kick.current())
    ro.observe(cv)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  useEffect(() => { kick.current() }, [active, playing, mode])
  return <canvas ref={ref} className={`block w-full ${className}`} aria-hidden data-audio-viz={mode} data-viz-live={active && playing ? '1' : '0'} />
}
