import { useEffect, useRef } from 'react'
import type { Channel } from '../lib/types'
import Daw from './Daw'

const dB = (g: number) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))

/** A project's console: the DAW the band edits together. */
export default function StudioConsole({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  return <Daw channel={channel} onClose={onClose} />
}

/** Vertical fader (silence to +3.5 dB; double-click for 0 dB) beside its meter, with the gain in dB underneath. */
export function Fader({ value, onChange, get, id, label }: { value: number; onChange: (v: number) => void; get: () => number; id: string; label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
      <div className="flex min-h-0 flex-1 justify-center gap-1.5">
        <input type="range" min={0} max={150} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} onDoubleClick={() => onChange(1)} className="h-full w-5 accent-accent" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} aria-label={label} data-console-fader={id} />
        <Meter get={get} id={id} vertical />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-text-2" data-console-db={id}>{dB(value)} dB</span>
    </div>
  )
}

/** Meter zones, like a hardware VU: green for most of the travel, amber near the top, red only at the very top. */
const zones = (dir: string) => `linear-gradient(to ${dir}, var(--color-success) 0 72%, var(--color-warn) 72% 90%, var(--color-danger) 90% 100%)`
/** LED segments: thin gaps cut into the lit bar. */
const segments = (dir: string, px: number) => `repeating-linear-gradient(to ${dir}, #000 0 ${px - 1}px, transparent ${px - 1}px ${px}px)`

/**
 * A level meter redrawn every frame without re-rendering: a dark track, the lit part in fixed colour zones (so the
 * colour tells you how hot it is, not the background), and a peak-hold tick that falls back after a moment.
 */
export function Meter({ get, id, vertical }: { get: () => number; id: string; vertical?: boolean }) {
  const lit = useRef<HTMLDivElement>(null)
  const peak = useRef<HTMLDivElement>(null)
  const getRef = useRef(get)
  getRef.current = get
  useEffect(() => {
    let raf = 0, hold = 0, holdAt = 0
    const tick = () => {
      const l = getRef.current(), now = performance.now()
      if (l >= hold || now - holdAt > 1200) { hold = Math.max(l, hold - 0.02); if (l >= hold) holdAt = now }
      const off = `${((1 - l) * 100).toFixed(1)}%`
      if (lit.current) { lit.current.style.clipPath = vertical ? `inset(${off} 0 0 0)` : `inset(0 ${off} 0 0)`; lit.current.parentElement!.dataset.level = l.toFixed(2) }
      if (peak.current) { peak.current.style[vertical ? 'bottom' : 'left'] = `calc(${(hold * 100).toFixed(1)}% - 1px)`; peak.current.style.opacity = hold > 0.02 ? '1' : '0' }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [vertical])
  const dir = vertical ? 'top' : 'right'
  return (
    <div className={`relative overflow-hidden rounded-sm bg-black/55 ring-1 ring-inset ring-white/5 ${vertical ? 'h-full w-2.5' : 'h-2 w-full'}`} data-console-meter={id}>
      <div ref={lit} className="absolute inset-0" style={{ background: zones(dir), clipPath: vertical ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)', WebkitMaskImage: vertical ? segments(dir, 4) : undefined, maskImage: vertical ? segments(dir, 4) : undefined }} />
      <div ref={peak} className={`absolute bg-white/80 opacity-0 ${vertical ? 'inset-x-0 h-0.5' : 'inset-y-0 w-0.5'}`} />
    </div>
  )
}
