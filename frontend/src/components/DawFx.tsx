import { Power, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { edit, editLive, engine } from '../lib/daw'
import { curve, FX, type Effect, type FxNode, type FxType, type ParamDef } from '../lib/fx'
import { useT } from '../lib/i18n'
import FloatWindow from './FloatWindow'

/*
 * The effect windows: one per effect, as many open at once as you like, each drawn like a plug-in with big knobs and a
 * view of what the effect does: its curve, and (while the project plays) the sound going in and coming out, live.
 * The views listen through analysers hung off the effect's input and output in the graph that plays; they never
 * change the sound.
 */

export type Owner = string | 'master'

/** Change an effect chain: a lane's, or the master's. */
export function setChain(owner: Owner, list: Effect[], liveKey?: string) {
  const op = owner === 'master' ? { op: 'project' as const, master_effects: list } : { op: 'lane.put' as const, lane: { id: owner, effects: list } }
  if (liveKey) editLive(liveKey, [op]); else edit([op])
}

/** Each effect's colour, for its knobs, curves and title. */
export const FX_COLOR: Record<FxType, string> = {
  eq: '#4fc3f7', compressor: '#ffb74d', reverb: '#b39ddb', delay: '#4dd0e1', drive: '#ff7043', filter: '#81c784', limiter: '#ef5350', chorus: '#f06292', gate: '#d4e157',
}

const fmt = (v: number, unit?: string) => {
  if (unit === 'Hz' && v >= 1000) return `${Number((v / 1000).toFixed(v >= 10000 ? 1 : 2))} kHz`
  return `${Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(2))}${unit ? `${unit.startsWith(':') ? '' : ' '}${unit}` : ''}`
}
/** Mix and feedback are fractions (0 to 1) shown as percentages. */
const isPct = (p: ParamDef) => !p.unit && p.min >= 0 && p.max <= 1
const show = (p: ParamDef, v: number) => (isPct(p) ? `${Math.round(v * 100)}%` : fmt(v, p.unit))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** A parameter's value as a knob position, 0 to 1 (log for frequencies), and back, on its step. */
const toNorm = (p: ParamDef, v: number) => clamp(p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min), 0, 1)
const fromNorm = (p: ParamDef, n: number) => {
  const x = p.log ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min)
  return clamp(p.step ? Math.round(x / p.step) * p.step : Math.round(x), p.min, p.max)
}

// --- listening to an effect -----------------------------------------------------------------------------------------

interface Tap { pre: AnalyserNode | null; post: AnalyserNode | null; node: FxNode | null; src: AudioNode | null }

/**
 * Analysers on an effect's input and output in the graph that plays, followed as the graph is rebuilt (play, stop, a
 * change to the chain). Empty while it isn't built: stopped, or bypassed.
 */
function useTap(owner: Owner, id: string) {
  const tap = useRef<Tap>({ pre: null, post: null, node: null, src: null })
  useEffect(() => {
    let timer = 0, dead = false
    const detach = () => {
      const t = tap.current
      try { if (t.src && t.pre) t.src.disconnect(t.pre) } catch { /* already gone */ }
      try { if (t.node && t.post) t.node.output.disconnect(t.post) } catch { /* already gone */ }
      tap.current = { pre: null, post: null, node: null, src: null }
    }
    const check = () => {
      if (dead) return
      const n = engine.ctx ? engine.fxNode(owner, id) : null
      if (n !== tap.current.node) {
        detach()
        if (n) {
          const ctx = n.output.context
          const make = () => { const a = ctx.createAnalyser(); a.fftSize = 4096; a.smoothingTimeConstant = 0.72; return a }
          const pre = make(), post = make(), src = n.feed ?? n.input
          src.connect(pre); n.output.connect(post)
          tap.current = { pre, post, node: n, src }
        }
      }
      timer = window.setTimeout(check, 250)
    }
    check()
    return () => { dead = true; clearTimeout(timer); detach() }
  }, [owner, id])
  return tap
}

const wave = new Float32Array(4096)
/** Peak and RMS of an analyser's last 85 ms, in dB. */
function levels(a: AnalyserNode | null): { peak: number; rms: number } | null {
  if (!a) return null
  a.getFloatTimeDomainData(wave)
  let p = 0, s = 0
  for (let i = 0; i < wave.length; i++) { const v = Math.abs(wave[i]); if (v > p) p = v; s += wave[i] * wave[i] }
  const db = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120)
  return { peak: db(p), rms: db(Math.sqrt(s / wave.length)) }
}

/** A canvas redrawn every frame at the screen's resolution, for as long as it is shown. */
function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number, now: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fn = useRef(draw)
  fn.current = draw
  useEffect(() => {
    let raf = 0, failed = false
    const loop = (now: number) => {
      const c = ref.current
      if (c && c.clientWidth) {
        const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
        const g = c.getContext('2d')
        // A frame that fails to draw must not stop the next one.
        if (g) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); try { fn.current(g, w, h, now) } catch (err) { if (!failed) { failed = true; console.error(err) } } }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

// --- drawing --------------------------------------------------------------------------------------------------------

/** Bypassed effects draw in grey (6-digit: the views add an alpha to colours). */
const OFF = '#666666', OFF_HANDLE = '#777777'
const F_LO = 20, F_HI = 20000
const xOfF = (f: number, w: number) => (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * w
const fOfX = (x: number, w: number) => F_LO * Math.pow(F_HI / F_LO, x / w)
const GRID = 'rgba(255,255,255,0.06)', LABEL = 'rgba(255,255,255,0.35)', FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace'

function freqGrid(g: CanvasRenderingContext2D, w: number, h: number, dbs: number[], yOf: (db: number) => number) {
  g.strokeStyle = GRID; g.lineWidth = 1; g.font = FONT; g.fillStyle = LABEL
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = Math.round(xOfF(f, w)) + 0.5
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke()
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, h - 4)
  }
  for (const db of dbs) {
    const y = Math.round(yOf(db)) + 0.5
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
    g.fillText(`${db > 0 ? '+' : ''}${db}`, 3, y - 3)
  }
}

const spec = new Float32Array(2048)
/** An analyser's spectrum as a filled shape (-100 to -10 dB, bottom to top). */
function spectrum(g: CanvasRenderingContext2D, a: AnalyserNode | null, w: number, h: number, fill: string, line?: string) {
  if (!a) return
  a.getFloatFrequencyData(spec)
  const ny = a.context.sampleRate / 2, n = a.frequencyBinCount
  g.beginPath(); g.moveTo(0, h)
  for (let x = 0; x <= w; x += 2) {
    const b0 = Math.floor((fOfX(x, w) / ny) * n), b1 = Math.max(b0 + 1, Math.floor((fOfX(x + 2, w) / ny) * n))
    let m = -200
    for (let b = b0; b < b1 && b < n; b++) if (spec[b] > m) m = spec[b]
    g.lineTo(x, h - clamp((m + 100) / 90, 0, 1) * h)
  }
  g.lineTo(w, h); g.closePath()
  g.fillStyle = fill; g.fill()
  if (line) { g.strokeStyle = line; g.lineWidth = 1; g.stroke() }
}

/** A glowing curve through points. */
function glow(g: CanvasRenderingContext2D, pts: [number, number][], color: string, width = 2, fillTo?: number) {
  if (!pts.length) return
  g.save()
  if (fillTo !== undefined) {
    g.beginPath(); g.moveTo(pts[0][0], fillTo); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(pts[pts.length - 1][0], fillTo); g.closePath()
    const gr = g.createLinearGradient(0, 0, 0, fillTo || 1); gr.addColorStop(0, `${color}55`); gr.addColorStop(1, `${color}05`)
    g.fillStyle = gr; g.fill()
  }
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.shadowColor = color; g.shadowBlur = 10; g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.stroke()
  g.restore()
}

function handle(g: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, hot: boolean) {
  g.save()
  g.beginPath(); g.arc(x, y, hot ? 8 : 6.5, 0, Math.PI * 2)
  g.fillStyle = hot ? color : '#16171d'; g.shadowColor = color; g.shadowBlur = hot ? 14 : 6; g.fill()
  g.lineWidth = 2; g.strokeStyle = color; g.stroke()
  g.shadowBlur = 0; g.fillStyle = hot ? '#000' : color; g.font = 'bold 9px ui-sans-serif, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(label, x, y + 0.5)
  g.restore()
}

/** Text over a view: when it isn't playing, or is bypassed. */
function note(g: CanvasRenderingContext2D, w: number, text: string) {
  g.save(); g.font = '11px ui-sans-serif, system-ui'; g.fillStyle = 'rgba(255,255,255,0.4)'; g.textAlign = 'right'; g.fillText(text, w - 8, 14); g.restore()
}

/** Scrolling history: the last few seconds of a few values, one sample per frame. */
function useHistory(n = 300) {
  return useRef({ rows: [] as number[][], push(...v: number[]) { this.rows.push(v); if (this.rows.length > n) this.rows.shift() }, n })
}

// --- the views -----------------------------------------------------------------------------------------------------

type View = (props: { e: Effect; tap: React.RefObject<Tap>; color: string; set: (key: string, v: number) => void; live: string }) => React.ReactElement

const H = 190

/** Biquads only used to draw a curve (their own silent context). */
function useBiquads(n: number) {
  return useMemo(() => {
    const ctx = new OfflineAudioContext(1, 128, 48000)
    return Array.from({ length: n }, () => ctx.createBiquadFilter())
  }, [n])
}
const FREQS = (() => { const n = 360, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = F_LO * Math.pow(F_HI / F_LO, i / (n - 1)); return a })()
const mag = new Float32Array(FREQS.length), phase = new Float32Array(FREQS.length)
/** The summed response (dB) of filters in series at FREQS. */
function response(fs: BiquadFilterNode[]) {
  const out = new Float32Array(FREQS.length)
  for (const f of fs) { f.getFrequencyResponse(FREQS, mag, phase); for (let i = 0; i < out.length; i++) out[i] += 20 * Math.log10(Math.max(1e-6, mag[i])) }
  return out
}

/** A view with handles to drag: `hit` finds the handle under the pointer, `drag` moves it. */
function useHandles<K extends string>(handles: () => { key: K; x: number; y: number }[], drag: (key: K, x: number, y: number, dy: number, fine: boolean) => void) {
  const [hot, setHot] = useState<K | null>(null)
  const active = useRef<{ key: K; y: number } | null>(null)
  const find = (x: number, y: number) => { let best: K | null = null, d = 16; for (const h of handles()) { const dd = Math.hypot(h.x - x, h.y - y); if (dd < d) { d = dd; best = h.key } } return best }
  const at = (e: RPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
  return {
    hot: active.current?.key ?? hot,
    bind: {
      onPointerDown: (e: RPointerEvent<HTMLCanvasElement>) => { const [x, y] = at(e); const k = find(x, y); if (!k) return; active.current = { key: k, y }; e.currentTarget.setPointerCapture(e.pointerId) },
      onPointerMove: (e: RPointerEvent<HTMLCanvasElement>) => { const [x, y] = at(e); if (active.current) { drag(active.current.key, x, y, active.current.y - y, e.shiftKey); active.current.y = y } else setHot(find(x, y)) },
      onPointerUp: () => { active.current = null },
      onPointerLeave: () => { if (!active.current) setHot(null) },
    },
  }
}

const EqView: View = ({ e, tap, color, set, live }) => {
  const [hp, lo, mid, hi] = useBiquads(4)
  const v = (k: string) => e.params[k] ?? FX.eq.params.find((p) => p.key === k)!.def
  const R = 18, W = useRef(400)
  const yOf = (db: number) => H / 2 - (db / R) * (H / 2 - 12)
  const dbOf = (y: number) => clamp(((H / 2 - y) / (H / 2 - 12)) * R, -15, 15)
  const spots = () => [
    { key: 'lowcut' as const, x: xOfF(v('lowcut'), W.current), y: yOf(0) },
    { key: 'low' as const, x: xOfF(120, W.current), y: yOf(v('low')) },
    { key: 'mid' as const, x: xOfF(v('midFreq'), W.current), y: yOf(v('mid')) },
    { key: 'high' as const, x: xOfF(8000, W.current), y: yOf(v('high')) },
  ]
  const h = useHandles(spots, (k, x, y) => {
    const half = (d: number) => Math.round(d * 2) / 2
    if (k === 'lowcut') set('lowcut', Math.round(clamp(fOfX(x, W.current), 20, 500)))
    if (k === 'low') set('low', half(dbOf(y)))
    if (k === 'high') set('high', half(dbOf(y)))
    if (k === 'mid') { set('midFreq', Math.round(clamp(fOfX(x, W.current), 200, 5000))); set('mid', half(dbOf(y))) }
  })
  const ref = useCanvas((g, w) => {
    W.current = w
    freqGrid(g, w, H, [-12, -6, 0, 6, 12], yOf)
    spectrum(g, tap.current?.pre ?? null, w, H, 'rgba(255,255,255,0.05)')
    spectrum(g, tap.current?.post ?? null, w, H, `${color}22`, `${color}55`)
    hp.type = 'highpass'; hp.Q.value = 0.7; hp.frequency.value = v('lowcut')
    lo.type = 'lowshelf'; lo.frequency.value = 120; lo.gain.value = v('low')
    mid.type = 'peaking'; mid.Q.value = 1; mid.frequency.value = v('midFreq'); mid.gain.value = v('mid')
    hi.type = 'highshelf'; hi.frequency.value = 8000; hi.gain.value = v('high')
    const r = response([hp, lo, mid, hi])
    glow(g, Array.from(FREQS, (f, i) => [xOfF(f, w), clamp(yOf(r[i]), 0, H)] as [number, number]), e.on ? color : OFF, 2.2, yOf(0))
    const labels = { lowcut: 'C', low: 'L', mid: 'M', high: 'H' }
    for (const s of spots()) handle(g, clamp(s.x, 9, w - 9), s.y, e.on ? color : OFF_HANDLE, labels[s.key], h.hot === s.key)
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full cursor-crosshair touch-none" {...h.bind} data-daw-fx-view="eq" data-daw-fx-hot={h.hot ?? ''} />
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const
const FilterView: View = ({ e, tap, color, set, live }) => {
  const [f] = useBiquads(1)
  const v = (k: string) => e.params[k] ?? FX.filter.params.find((p) => p.key === k)!.def
  const top = 30, bottom = -42, W = useRef(400)
  const yOf = (db: number) => ((top - db) / (top - bottom)) * H
  const respAt = (freq: number) => { const r = response([f]); let i = 0; while (i < FREQS.length - 1 && FREQS[i] < freq) i++; return r[i] }
  const spots = () => [{ key: 'cut' as const, x: xOfF(v('freq'), W.current), y: clamp(yOf(respAt(v('freq'))), 6, H - 6) }]
  const h = useHandles(spots, (_k, x, _y, dy, fine) => {
    set('freq', Math.round(clamp(fOfX(x, W.current), 20, 20000)))
    if (dy) set('q', clamp(Math.round(v('q') * Math.pow(1.02, dy * (fine ? 0.25 : 1)) * 10) / 10, 0.1, 20))
  })
  const ref = useCanvas((g, w) => {
    W.current = w
    f.type = FILTER_TYPES[Math.round(v('mode'))] ?? 'lowpass'; f.frequency.value = v('freq'); f.Q.value = v('q')
    freqGrid(g, w, H, [24, 12, 0, -12, -24, -36], yOf)
    spectrum(g, tap.current?.pre ?? null, w, H, 'rgba(255,255,255,0.06)')
    spectrum(g, tap.current?.post ?? null, w, H, `${color}26`, `${color}60`)
    const r = response([f])
    glow(g, Array.from(FREQS, (fr, i) => [xOfF(fr, w), clamp(yOf(r[i]), 0, H)] as [number, number]), e.on ? color : OFF, 2.4, H)
    for (const s of spots()) handle(g, s.x, s.y, e.on ? color : OFF_HANDLE, '', h.hot === s.key)
    g.save(); g.font = FONT; g.fillStyle = color; g.fillText(`${fmt(v('freq'), 'Hz')}  Q ${v('q').toFixed(1)}`, 8, 14); g.restore()
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full cursor-crosshair touch-none" {...h.bind} onWheel={(ev) => set('q', clamp(Math.round(v('q') * (ev.deltaY < 0 ? 1.1 : 0.9) * 10) / 10, 0.1, 20))} data-daw-fx-view="filter" data-daw-fx-hot={h.hot ?? ''} />
}

/** A dynamics view: the transfer curve (input level to output level) with a dot where the signal is now, then the
 *  last five seconds of input level and gain reduction, and a gain-reduction meter. */
function DynamicsView({ e, tap, color, live, kind }: Parameters<View>[0] & { kind: 'compressor' | 'limiter' | 'gate' }) {
  const v = (k: string) => e.params[k] ?? FX[kind].params.find((p) => p.key === k)!.def
  const hist = useHistory()
  const gr = useRef(0), dot = useRef(-120)
  const out = (x: number) => {
    if (kind === 'compressor') {
      const T = v('threshold'), R = v('ratio'), K = 6, m = v('makeup')
      const y = x < T - K / 2 ? x : x > T + K / 2 ? T + (x - T) / R : x + ((1 / R - 1) * (x - T + K / 2) ** 2) / (2 * K)
      return y + m
    }
    if (kind === 'limiter') return Math.min(x, v('ceiling'))
    return x >= v('threshold') ? x : Math.max(-100, x + v('range'))
  }
  const ref = useCanvas((g, w) => {
    const pre = levels(tap.current?.pre ?? null), post = levels(tap.current?.post ?? null)
    let red = 0
    if (pre && post) red = kind === 'compressor' && tap.current?.node?.reduction ? tap.current.node.reduction() : Math.min(0, post.peak - pre.peak)
    gr.current += (red - gr.current) * 0.3
    if (pre) dot.current += ((kind === 'limiter' ? pre.peak : pre.rms) - dot.current) * 0.35
    hist.current.push(pre ? pre.peak : -120, post ? post.peak : -120, gr.current)
    // Transfer curve, -60 to 0 dB both ways.
    const S = H, lo = -60, sx = (db: number) => ((db - lo) / -lo) * (S - 16) + 8, sy = (db: number) => S - 8 - ((db - lo) / -lo) * (S - 16)
    g.strokeStyle = GRID; g.lineWidth = 1
    for (let d = lo; d <= 0; d += 12) { g.beginPath(); g.moveTo(sx(d) + 0.5, 8); g.lineTo(sx(d) + 0.5, S - 8); g.moveTo(8, sy(d) + 0.5); g.lineTo(S - 8, sy(d) + 0.5); g.stroke() }
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(sx(lo), sy(lo)); g.lineTo(sx(0), sy(0)); g.stroke(); g.setLineDash([])
    const pts: [number, number][] = []
    for (let d = lo; d <= 0; d += 0.5) pts.push([sx(d), clamp(sy(out(d)), 8, S - 8)])
    glow(g, pts, e.on ? color : OFF, 2.4)
    const marker = kind === 'compressor' || kind === 'gate' ? v('threshold') : v('ceiling')
    g.strokeStyle = `${color}66`; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(sx(marker), 8); g.lineTo(sx(marker), S - 8); g.stroke(); g.setLineDash([])
    if (pre && dot.current > lo) {
      g.save(); g.beginPath(); g.arc(sx(dot.current), clamp(sy(out(dot.current)), 8, S - 8), 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.shadowColor = color; g.shadowBlur = 16; g.fill(); g.restore()
    }
    g.font = FONT; g.fillStyle = LABEL; g.fillText('in →', S - 36, S - 12); g.save(); g.translate(14, 40); g.rotate(-Math.PI / 2); g.fillText('out →', 0, 0); g.restore()

    // History: input peak (grey), output peak (colour), threshold or ceiling, and gain reduction from the top.
    const x0 = S + 10, gw = w - x0 - 22, rows = hist.current.rows, n = hist.current.n
    const hy = (db: number) => 8 + (clamp(-db, 0, 60) / 60) * (H - 16)
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, 8, gw, H - 16)
    g.strokeStyle = GRID; for (let d = 0; d >= -60; d -= 12) { g.beginPath(); g.moveTo(x0, hy(d) + 0.5); g.lineTo(x0 + gw, hy(d) + 0.5); g.stroke() }
    const col = (i: number) => x0 + gw - (rows.length - 1 - i) * (gw / n)
    g.beginPath(); g.moveTo(col(0), H - 8); rows.forEach((r, i) => g.lineTo(col(i), hy(r[0]))); g.lineTo(col(rows.length - 1), H - 8); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill()
    glow(g, rows.map((r, i) => [col(i), hy(r[1])] as [number, number]), color, 1.4)
    g.beginPath(); g.moveTo(col(0), 8); rows.forEach((r, i) => g.lineTo(col(i), 8 + (clamp(-r[2], 0, 30) / 30) * (H - 16) * 0.5)); g.lineTo(col(rows.length - 1), 8); g.closePath(); g.fillStyle = 'rgba(239,83,80,0.35)'; g.fill()
    g.setLineDash([4, 4]); g.strokeStyle = `${color}aa`; g.beginPath(); g.moveTo(x0, hy(marker) + 0.5); g.lineTo(x0 + gw, hy(marker) + 0.5); g.stroke(); g.setLineDash([])
    // Gain reduction meter.
    const mx = w - 16
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(mx, 8, 10, H - 16)
    const grh = (clamp(-gr.current, 0, 30) / 30) * (H - 16)
    const grd = g.createLinearGradient(0, 8, 0, H - 8); grd.addColorStop(0, '#ffb74d'); grd.addColorStop(1, '#ef5350')
    g.fillStyle = grd; g.fillRect(mx, 8, 10, grh)
    g.font = FONT; g.fillStyle = LABEL; g.textAlign = 'right'; g.fillText(`GR ${gr.current.toFixed(1)} dB`, mx - 4, H - 12); g.textAlign = 'left'
    if (kind === 'gate' && pre) {
      const open = !post || post.rms > pre.rms - 6
      g.save(); g.beginPath(); g.arc(x0 + 12, H - 16, 5, 0, Math.PI * 2); g.fillStyle = open ? '#9ccc65' : '#3a3d47'; g.shadowColor = '#9ccc65'; g.shadowBlur = open ? 12 : 0; g.fill(); g.restore()
      g.fillStyle = open ? '#9ccc65' : LABEL; g.fillText(open ? 'OPEN' : 'CLOSED', x0 + 22, H - 12)
    }
    if (live) note(g, w - 22, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full" data-daw-fx-view={kind} />
}

/** What comes out over time: an oscilloscope, steadied on a rising zero crossing. */
function scope(g: CanvasRenderingContext2D, a: AnalyserNode | null, x0: number, y0: number, w: number, h: number, color: string, width = 1.5) {
  if (!a) return
  a.getFloatTimeDomainData(wave)
  let s = 0
  for (let i = 1; i < 2048; i++) if (wave[i - 1] < 0 && wave[i] >= 0) { s = i; break }
  const n = 1024, pts: [number, number][] = []
  for (let i = 0; i < n; i += 2) pts.push([x0 + (i / n) * w, y0 + h / 2 - clamp(wave[s + i], -1, 1) * (h / 2 - 4)])
  glow(g, pts, color, width)
}

const ReverbView: View = ({ e, tap, color, live }) => {
  const v = (k: string) => e.params[k] ?? FX.reverb.params.find((p) => p.key === k)!.def
  const energy = useRef(0)
  const ref = useCanvas((g, w, h, now) => {
    const size = v('size'), tone = v('tone'), mix = v('mix'), span = Math.max(1, Math.ceil(size * 1.15))
    const post = levels(tap.current?.post ?? null)
    energy.current += ((post ? clamp((post.rms + 60) / 60, 0, 1) : 0) - energy.current) * 0.15
    spectrum(g, tap.current?.post ?? null, w, h, `${color}14`)
    g.strokeStyle = GRID; g.font = FONT; g.fillStyle = LABEL
    for (let s = 0; s <= span; s++) { const x = (s / span) * w + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); if (s < span) g.fillText(`${s}s`, x + 3, h - 4) }
    // The impulse as Parley builds it: noise under (1 - t / size)³. Darker, softer noise the lower the tone.
    const mid = h / 2, amp = (h / 2 - 14) * (0.35 + 0.65 * mix), bright = Math.log(tone / 1000) / Math.log(20)
    let seed = 99
    g.save(); g.shadowColor = color; g.shadowBlur = 6 + energy.current * 18
    for (let x = 0; x < w; x += 2) {
      const t = (x / w) * span
      if (t > size) break
      const env = Math.pow(1 - t / size, 3)
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const n = 0.35 + 0.65 * Math.abs(Math.sin(seed)) * (0.4 + 0.6 * bright)
      const a = env * amp * n
      g.fillStyle = `rgba(${Math.round(150 + 105 * bright)}, ${Math.round(130 + 80 * bright)}, 230, ${0.25 + 0.6 * env})`
      g.fillRect(x, mid - a, 1.5, a * 2)
    }
    g.restore()
    const env: [number, number][] = []
    for (let x = 0; x <= w; x += 3) { const t = (x / w) * span; if (t > size) break; env.push([x, mid - Math.pow(1 - t / size, 3) * amp]) }
    glow(g, env, e.on ? color : OFF, 1.6)
    // A wave travelling out through the tail while sound is coming in.
    if (energy.current > 0.05) { const x = ((now / 1000) % size) / span * w; g.fillStyle = `${color}88`; g.fillRect(x, 10, 2, h - 20) }
    g.fillStyle = color; g.font = FONT; g.fillText(`decay ${size.toFixed(1)} s · tone ${fmt(tone, 'Hz')} · ${Math.round(mix * 100)}% wet`, 8, 14)
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full" data-daw-fx-view="reverb" />
}

const DelayView: View = ({ e, tap, color, live }) => {
  const v = (k: string) => e.params[k] ?? FX.delay.params.find((p) => p.key === k)!.def
  const ref = useCanvas((g, w, h, now) => {
    const time = v('time'), fb = v('feedback'), mix = v('mix'), tone = v('tone')
    const span = clamp(time * 8, 1000, 6000)
    scope(g, tap.current?.post ?? null, 0, h * 0.55, w, h * 0.45, `${color}66`, 1)
    g.strokeStyle = GRID; g.font = FONT; g.fillStyle = LABEL
    for (let s = 0; s <= span; s += 500) { const x = (s / span) * w + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.fillText(`${s / 1000}s`, x + 3, h - 4) }
    const base = h * 0.6, tall = h * 0.5
    const cursor = (now % span) / span * w
    // The dry hit, then each echo: quieter by the feedback, and darker by the tone each time round.
    const dark = 1 - Math.log(tone / 500) / Math.log(40)
    const bars: { x: number; a: number; dry: boolean }[] = [{ x: 0, a: 1 - mix, dry: true }]
    for (let k = 1, a = mix; a > 0.003 && k * time <= span; k++, a *= fb) bars.push({ x: (k * time / span) * w, a: a * Math.pow(1 - 0.3 * dark, k - 1), dry: false })
    for (const b of bars) {
      const hot = cursor >= b.x && cursor - b.x < 18
      g.save(); g.shadowColor = color; g.shadowBlur = hot ? 18 : 8
      g.fillStyle = b.dry ? 'rgba(255,255,255,0.55)' : hot ? '#fff' : color
      g.fillRect(b.x + 1, base - b.a * tall, 5, b.a * tall)
      g.restore()
    }
    g.fillStyle = `${color}55`; g.fillRect(cursor, 18, 1.5, base - 18)
    g.fillStyle = color; g.fillText(`${Math.round(time)} ms · feedback ${Math.round(fb * 100)}% · ${bars.length - 1} echoes`, 8, 14)
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full" data-daw-fx-view="delay" />
}

const DriveView: View = ({ e, tap, color, live }) => {
  const v = (k: string) => e.params[k] ?? FX.drive.params.find((p) => p.key === k)!.def
  const shape = useMemo(() => curve(v('amount')), [e.params.amount]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useCanvas((g, w, h) => {
    const S = h, mix = v('mix'), outG = Math.pow(10, v('output') / 20)
    g.strokeStyle = GRID
    for (let i = 0; i <= 4; i++) { const p = 8 + (i / 4) * (S - 16) + 0.5; g.beginPath(); g.moveTo(p, 8); g.lineTo(p, S - 8); g.moveTo(8, p); g.lineTo(S - 8, p); g.stroke() }
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(8, S - 8); g.lineTo(S - 8, 8); g.stroke(); g.setLineDash([])
    const pts: [number, number][] = []
    for (let i = 0; i <= 120; i++) {
      const x = i / 60 - 1, y = (mix * shape[Math.min(shape.length - 1, Math.round(((x + 1) / 2) * (shape.length - 1)))] + (1 - mix) * x) * outG
      pts.push([8 + ((x + 1) / 2) * (S - 16), clamp(S / 2 - y * (S / 2 - 8), 4, S - 4)])
    }
    glow(g, pts, e.on ? color : OFF, 2.4)
    g.font = FONT; g.fillStyle = LABEL; g.fillText('shape', 12, 18)
    const x0 = S + 10
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, 8, w - x0 - 4, h - 16)
    scope(g, tap.current?.pre ?? null, x0, 8, w - x0 - 4, h - 16, 'rgba(255,255,255,0.35)', 1)
    scope(g, tap.current?.post ?? null, x0, 8, w - x0 - 4, h - 16, color, 1.8)
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x0 + 4, h - 26, 50, 16)
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('in', x0 + 9, h - 14); g.fillStyle = color; g.fillText('out', x0 + 27, h - 14)
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full" data-daw-fx-view="drive" />
}

const ChorusView: View = ({ e, tap, color, live }) => {
  const v = (k: string) => e.params[k] ?? FX.chorus.params.find((p) => p.key === k)!.def
  const ref = useCanvas((g, w, h, now) => {
    const rate = v('rate'), depth = v('depth'), mix = v('mix'), span = 2
    scope(g, tap.current?.post ?? null, 0, h * 0.5, w, h * 0.5, `${color}55`, 1)
    g.strokeStyle = GRID; g.font = FONT; g.fillStyle = LABEL
    const mid = h * 0.38, amp = (depth / 10) * (h * 0.3)
    g.beginPath(); g.moveTo(0, mid + 0.5); g.lineTo(w, mid + 0.5); g.stroke()
    // The delay time sweeping around 20 ms: one voice, and a fainter copy for the dry signal it beats against.
    const phase = (now / 1000) * rate * Math.PI * 2
    const pts: [number, number][] = []
    for (let x = 0; x <= w; x += 2) pts.push([x, mid - Math.sin(phase - (x / w) * span * rate * Math.PI * 2) * amp])
    glow(g, pts, e.on ? color : OFF, 2.2)
    g.save(); g.beginPath(); g.arc(0 + 6, mid - Math.sin(phase) * amp, 6, 0, Math.PI * 2); g.fillStyle = '#fff'; g.shadowColor = color; g.shadowBlur = 16; g.fill(); g.restore()
    g.fillStyle = color; g.fillText(`${rate.toFixed(1)} Hz · ±${depth.toFixed(1)} ms · ${Math.round(mix * 100)}% wet`, 14, 14)
    if (live) note(g, w, live)
  })
  return <canvas ref={ref} className="h-[190px] w-full" data-daw-fx-view="chorus" />
}

const VIEWS: Record<FxType, View> = {
  eq: EqView, filter: FilterView, reverb: ReverbView, delay: DelayView, drive: DriveView, chorus: ChorusView,
  compressor: (p) => <DynamicsView {...p} kind="compressor" />, limiter: (p) => <DynamicsView {...p} kind="limiter" />, gate: (p) => <DynamicsView {...p} kind="gate" />,
}

/** Input and output level, either side of the view. */
function IoMeter({ tap, side, color }: { tap: React.RefObject<Tap>; side: 'pre' | 'post'; color: string }) {
  const held = useRef(-120)
  const ref = useCanvas((g, w, h) => {
    const l = levels(tap.current?.[side] ?? null)
    const pos = (db: number) => clamp((db + 60) / 66, 0, 1)
    held.current = l ? Math.max(l.peak, held.current - 0.6) : -120
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, w, h)
    if (!l) return
    const grd = g.createLinearGradient(0, h, 0, 0); grd.addColorStop(0, color); grd.addColorStop(0.8, '#ffd54f'); grd.addColorStop(0.92, '#ef5350')
    g.fillStyle = grd
    const r = pos(l.rms) * h, p = pos(l.peak) * h
    g.globalAlpha = 0.45; g.fillRect(0, h - p, w, p); g.globalAlpha = 1; g.fillRect(0, h - r, w, r)
    g.fillStyle = '#fff'; g.fillRect(0, h - pos(held.current) * h, w, 1.5)
  })
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas ref={ref} className="h-[176px] w-2 rounded-sm" data-daw-fx-meter={side} />
      <span className="text-[9px] font-bold uppercase tracking-wide text-white/40">{side === 'pre' ? 'In' : 'Out'}</span>
    </div>
  )
}

// --- knobs ----------------------------------------------------------------------------------------------------------

/** A plug-in knob: drag up or down (Shift for fine), wheel, arrow keys; double-click resets; type a value under it. */
function FxKnob({ p, value, color, onChange, label }: { p: ParamDef; value: number; color: string; onChange: (v: number) => void; label: string }) {
  const n = toNorm(p, value)
  const bipolar = p.min < 0 && p.max > 0
  const size = 58, c = size / 2, r = 23
  const a0 = -135, a = a0 + n * 270, from = bipolar ? a0 + toNorm(p, 0) * 270 : a0
  const pt = (deg: number, rr = r) => [c + rr * Math.sin((deg * Math.PI) / 180), c - rr * Math.cos((deg * Math.PI) / 180)]
  const arc = (x: number, y: number) => { const [x0, y0] = pt(Math.min(x, y)), [x1, y1] = pt(Math.max(x, y)); return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(y - x) > 180 ? 1 : 0} 1 ${x1} ${y1}` }
  const svg = useRef<SVGSVGElement>(null)
  const latest = useRef({ n, onChange })
  latest.current = { n, onChange }
  const nudge = (d: number) => latest.current.onChange(fromNorm(p, clamp(latest.current.n + d, 0, 1)))
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const wheel = (ev: WheelEvent) => { ev.preventDefault(); nudge((ev.deltaY < 0 ? 1 : -1) * (ev.shiftKey ? 0.005 : 0.02)) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const drag = (ev: RPointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return
    const el = ev.currentTarget, start = ev.clientY, n0 = n
    el.setPointerCapture(ev.pointerId)
    const move = (m: PointerEvent) => latest.current.onChange(fromNorm(p, clamp(n0 + (start - m.clientY) / (m.shiftKey ? 800 : 180), 0, 1)))
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }
  const [typing, setTyping] = useState<string | null>(null)
  // Typed as shown or bare: "2.5 kHz", "2.5k" and "2500" are all 2500 Hz; "25%" is a mix of 0.25.
  const commit = () => {
    if (typing !== null) {
      const m = /^\s*(-?[\d.]+)\s*(k)?/i.exec(typing)
      let x = m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : NaN
      // A percentage: "25%" or "25" are a quarter; "0.25" is too.
      if (isPct(p) && (typing.includes('%') || x > 1)) x /= 100
      if (Number.isFinite(x)) onChange(clamp(p.step ? Math.round(x / p.step) * p.step : x, p.min, p.max))
    }
    setTyping(null)
  }
  const [px, py] = pt(a, r - 9)
  return (
    <div className="flex w-[74px] flex-col items-center gap-0.5" data-daw-fx-knob={p.key}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/55">{label}</span>
      <svg ref={svg} width={size} height={size} role="slider" tabIndex={0} aria-label={label} aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={Number(value.toFixed(3))} aria-valuetext={show(p, value)}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/60" onPointerDown={drag} onDoubleClick={() => onChange(p.def)}
        onKeyDown={(ev) => { if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') { ev.preventDefault(); nudge(ev.shiftKey ? 0.005 : 0.02) } if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(ev.shiftKey ? -0.005 : -0.02) } }} data-daw-fx-param={p.key}>
        <defs>
          <radialGradient id={`kb-${p.key}`} cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#4a4d5a" /><stop offset="1" stopColor="#1b1c22" /></radialGradient>
        </defs>
        <path d={arc(a0, 135)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} strokeLinecap="round" />
        {Math.abs(a - from) > 0.5 && <path d={arc(from, a)} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />}
        <circle cx={c} cy={c} r={r - 6} fill={`url(#kb-${p.key})`} stroke="rgba(0,0,0,0.6)" strokeWidth={1} />
        <circle cx={c} cy={c} r={r - 6} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} transform={`translate(0 -0.5)`} />
        <line x1={c} y1={c} x2={px} y2={py} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <input value={typing ?? show(p, value)} onFocus={(ev) => ev.target.select()} onChange={(ev) => setTyping(ev.target.value)} onBlur={commit} onKeyDown={(ev) => { if (ev.key === 'Enter') { commit(); (ev.target as HTMLInputElement).blur() } if (ev.key === 'Escape') { setTyping(null); (ev.target as HTMLInputElement).blur() } }}
        className="w-full rounded bg-black/40 px-1 py-0.5 text-center font-mono text-[11px] tabular-nums text-white outline-none focus:ring-1" style={{ ['--tw-ring-color' as string]: color }} aria-label={`${label} value`} data-daw-fx-value={p.key} />
    </div>
  )
}

// --- the window -----------------------------------------------------------------------------------------------------

/** One effect's window. `cascade` places a newly opened one a step away from the others. */
export function FxWindow({ owner, list, id, close, title, cascade }: { owner: Owner; list: Effect[]; id: string; close: () => void; title: string; cascade: number }) {
  const t = useT()
  const tap = useTap(owner, id)
  const e = list.find((x) => x.id === id)
  const [, tick] = useState(0)
  // Say whether it's live: the views read the tap every frame, this only updates the note.
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i) }, [])
  if (!e || !FX[e.type]) return null
  const def = FX[e.type], color = FX_COLOR[e.type]
  const latest = { list, e }
  const set = (key: string, v: number) => setChain(owner, latest.list.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: v } } : x)), `fx:${owner}:${id}:${key}`)
  const live = !e.on ? t('Bypassed') : tap.current.node ? '' : t('Play to see it live')
  const View = VIEWS[e.type]
  const knobs = def.params.filter((p) => !(e.type === 'filter' && p.key === 'mode'))
  return (
    <FloatWindow id={`fx-${owner}-${id}`} cascade={cascade} width={500} onClose={close} bodyClass="p-0" data-daw-fx-editor={e.type} data-daw-fx-window={id} data-daw-fx-live={tap.current.node ? 'yes' : 'no'}
      icon={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
      title={<>{def.name} <span className="font-normal text-text-2">· {title}</span></>}
      headerExtra={<>
        <button type="button" onClick={() => setChain(owner, list.map((x) => (x.id === id ? { ...x, params: Object.fromEntries(def.params.map((p) => [p.key, p.def])) } : x)))} title={t('Reset to the defaults')} className="text-text-2 hover:text-text-0" data-daw-fx-reset><RotateCcw size={14} /></button>
        <button type="button" onClick={() => setChain(owner, list.map((x) => (x.id === id ? { ...x, on: !x.on } : x)))} title={e.on ? t('Bypass') : t('Turn on')} aria-pressed={e.on} className="rounded-full p-0.5" style={{ color: e.on ? color : undefined, filter: e.on ? `drop-shadow(0 0 4px ${color})` : undefined }} data-daw-fx-window-power><Power size={15} /></button>
      </>}>
      <div className="select-none text-white" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${color}1f, transparent 60%), linear-gradient(#1c1d24, #121318)` }}>
        <div className="flex items-start gap-2 px-3 pt-3">
          <IoMeter tap={tap} side="pre" color={color} />
          <div className={`min-w-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-black/30 shadow-inner transition-opacity ${e.on ? '' : 'opacity-50'}`}>
            <View e={e} tap={tap} color={color} set={set} live={live} />
          </div>
          <IoMeter tap={tap} side="post" color={color} />
        </div>
        {e.type === 'filter' && (
          <div className="flex justify-center gap-1 px-3 pt-3" role="radiogroup" aria-label={t('Filter type')}>
            {[t('Low-pass'), t('High-pass'), t('Band-pass')].map((name, i) => {
              const on = Math.round(e.params.mode ?? 0) === i
              return <button key={name} type="button" role="radio" aria-checked={on} onClick={() => set('mode', i)} className={`rounded-md px-3 py-1 text-xs font-bold transition ${on ? 'text-black' : 'bg-white/5 text-white/60 hover:text-white'}`} style={on ? { background: color, boxShadow: `0 0 12px ${color}88` } : undefined} data-daw-fx-mode={i}>{name}</button>
            })}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-x-2 gap-y-3 px-3 pb-4 pt-3">
          {knobs.map((p) => <FxKnob key={p.key} p={p} value={e.params[p.key] ?? p.def} color={e.on ? color : OFF_HANDLE} onChange={(v) => set(p.key, v)} label={p.label} />)}
        </div>
      </div>
    </FloatWindow>
  )
}
