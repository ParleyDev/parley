import { useEffect, useRef } from 'react'
import { clearClip, isClipped, meterPos, toDb, type Reading } from '../lib/meters'
import { useT } from '../lib/i18n'
import type { Channel } from '../lib/types'
import Daw from './Daw'

const dB = (g: number) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))

/** A project's console: the DAW the band edits together. */
export default function StudioConsole({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  return <Daw channel={channel} onClose={onClose} />
}

/** Vertical fader (silence to +3.5 dB; double-click for 0 dB) beside its meter and the meter's scale, with the gain in dB underneath. */
export function Fader({ value, onChange, get, id, label }: { value: number; onChange: (v: number) => void; get: () => Reading | null; id: string; label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
      <div className="flex min-h-0 flex-1 justify-center gap-1.5">
        <input type="range" min={0} max={150} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} onDoubleClick={() => onChange(1)} className="h-full w-5 accent-accent" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} aria-label={label} data-console-fader={id} />
        <Meter get={get} id={id} vertical scale />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-text-2" data-console-db={id}>{dB(value)} dB</span>
    </div>
  )
}

const pct = (db: number) => `${(meterPos(db) * 100).toFixed(1)}%`
/** Meter zones by level: green up to -12 dB, amber from there to full scale, red over it. */
const zones = (dir: string) => `linear-gradient(to ${dir}, var(--color-success) 0 ${pct(-12)}, var(--color-warn) ${pct(-12)} ${pct(0)}, var(--color-danger) ${pct(0)} 100%)`
/** LED segments: thin gaps cut into the lit bar. */
const segments = (dir: string, px: number) => `repeating-linear-gradient(to ${dir}, #000 0 ${px - 1}px, transparent ${px - 1}px ${px}px)`
/** The levels marked beside a meter, in dB. */
const TICKS = [6, 0, -6, -12, -24, -36, -48]

/**
 * A level meter redrawn every frame without re-rendering, on a scale in dB (-60 at the bottom, full scale near the
 * top, 6 dB above it): the solid bar is the RMS level, the fainter bar above it the peak, the tick the highest peak
 * of the last moment. The light at the end comes on when a sample went over full scale and stays on until clicked.
 */
export function Meter({ get, id, vertical, scale }: { get: () => Reading | null; id: string; vertical?: boolean; scale?: boolean }) {
  const t = useT()
  const track = useRef<HTMLDivElement>(null)
  const rms = useRef<HTMLDivElement>(null)
  const peak = useRef<HTMLDivElement>(null)
  const tick = useRef<HTMLDivElement>(null)
  const led = useRef<HTMLButtonElement>(null)
  const getRef = useRef(get)
  getRef.current = get
  useEffect(() => {
    let raf = 0, hold = 0, holdAt = 0
    const clipTo = (el: HTMLElement | null, pos: number) => { if (el) { const off = `${((1 - pos) * 100).toFixed(1)}%`; el.style.clipPath = vertical ? `inset(${off} 0 0 0)` : `inset(0 ${off} 0 0)` } }
    const draw = () => {
      const r = getRef.current(), now = performance.now()
      const pdb = r ? toDb(r.peak) : -Infinity, rdb = r ? toDb(r.rms) : -Infinity
      const p = meterPos(pdb), q = meterPos(rdb), clip = isClipped(id)
      if (p >= hold || now - holdAt > 1200) { hold = Math.max(p, hold - 0.02); if (p >= hold) holdAt = now }
      clipTo(rms.current, q); clipTo(peak.current, p)
      if (tick.current) { tick.current.style[vertical ? 'bottom' : 'left'] = `calc(${(hold * 100).toFixed(1)}% - 1px)`; tick.current.style.opacity = hold > 0.02 ? '1' : '0' }
      if (led.current) { const on = clip ? '1' : '0'; if (led.current.dataset.on !== on) { led.current.dataset.on = on; led.current.style.background = clip ? 'var(--color-danger)' : '' } }
      const d = track.current?.dataset
      if (d) {
        const level = p.toFixed(2), pk = isFinite(pdb) ? pdb.toFixed(1) : '', rm = isFinite(rdb) ? rdb.toFixed(1) : ''
        if (d.level !== level) d.level = level
        if (d.peakDb !== pk) d.peakDb = pk
        if (d.rmsDb !== rm) d.rmsDb = rm
        if (d.clip !== (clip ? '1' : '0')) d.clip = clip ? '1' : '0'
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [vertical, id])
  const dir = vertical ? 'top' : 'right'
  const mask = vertical ? segments(dir, 4) : undefined
  const hidden = vertical ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)'
  return (
    <div className={vertical ? 'flex h-full flex-col gap-0.5' : 'flex w-full items-center gap-0.5'}>
      <div className={`flex min-h-0 gap-0.5 ${vertical ? 'order-2 flex-1' : 'flex-1'}`}>
        <div ref={track} className={`relative overflow-hidden rounded-sm bg-black/55 ring-1 ring-inset ring-white/5 ${vertical ? 'h-full w-2.5' : 'h-2 w-full'}`} data-console-meter={id}>
          <div ref={peak} className="absolute inset-0 opacity-40" style={{ background: zones(dir), clipPath: hidden, WebkitMaskImage: mask, maskImage: mask }} />
          <div ref={rms} className="absolute inset-0" style={{ background: zones(dir), clipPath: hidden, WebkitMaskImage: mask, maskImage: mask }} />
          <div ref={tick} className={`absolute bg-white/80 opacity-0 ${vertical ? 'inset-x-0 h-0.5' : 'inset-y-0 w-0.5'}`} />
        </div>
        {vertical && scale && <div className="relative h-full w-4 font-mono text-[8px] leading-none text-text-2" aria-hidden>{TICKS.map((d) => <span key={d} className="absolute left-0" style={{ bottom: pct(d), transform: 'translateY(50%)' }}>{d > 0 ? `+${d}` : d}</span>)}</div>}
      </div>
      <button ref={led} type="button" onClick={(e) => { e.stopPropagation(); clearClip(id) }} title={t('Clip: a sample went over full scale. Click to clear.')} aria-label={t('Clip indicator')} className={`shrink-0 rounded-sm bg-black/55 ring-1 ring-inset ring-white/10 ${vertical ? 'order-1 h-2 w-2.5' : 'h-2 w-2'}`} data-console-clip={id} />
    </div>
  )
}
