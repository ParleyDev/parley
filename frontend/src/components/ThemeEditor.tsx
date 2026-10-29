import { useRef, type CSSProperties } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { gradientCss, lookContrast, themeVars, type Look } from '../lib/colorThemes'
import { useT } from '../lib/i18n'

/** A colour theme's swatch: its gradient, as on Discord's theme picker. */
export function ThemeSwatch({ look, size = 48, selected, className = '' }: { look: Look; size?: number; selected?: boolean; className?: string }) {
  return <span className={`block shrink-0 rounded-full border-2 ${selected ? 'border-accent ring-2 ring-accent/40' : 'border-white/10'} ${className}`} style={{ width: size, height: size, background: gradientCss(look) }} data-theme-swatch />
}

/**
 * The colour theme editor shared by the admin console, your own custom theme and a server's theme: base, an angle
 * dial, how strongly it tints the app (midpoint), 2-5 colour stops, a live preview of the app in it, and contrast
 * warnings (secondary text is adjusted automatically; the warnings say when and by how much it still falls short).
 */
export default function ThemeEditor({ value, onChange, name, onName }: { value: Look; onChange: (l: Look) => void; name?: string; onName?: (n: string) => void }) {
  const t = useT()
  const set = (patch: Partial<Look>) => onChange({ ...value, ...patch })
  const stops = value.stops
  const setStop = (i: number, patch: Partial<Look['stops'][number]>) => set({ stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const c = lookContrast(value)
  const { adjusted } = themeVars(value)
  return (
    <div className="grid grid-cols-[1fr_260px] phone:grid-cols-1 gap-5" data-theme-editor>
      <div className="space-y-4 min-w-0">
        {onName && (
          <div><label className="label">{t('Name')}</label><input className="input" value={name ?? ''} maxLength={40} onChange={(e) => onName(e.target.value)} data-theme-name /></div>
        )}
        <div>
          <label className="label">{t('Base')}</label>
          <div className="flex gap-2" data-theme-base>
            {(['light', 'dark'] as const).map((b) => (
              <button key={b} type="button" onClick={() => set({ base: b })} aria-pressed={value.base === b} className={`rounded-md border px-3 py-1.5 text-sm ${value.base === b ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-theme-base-option={b}>{b === 'light' ? t('Light') : t('Dark')}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <AngleDial angle={value.angle} onChange={(a) => set({ angle: a })} />
          <div className="flex-1 min-w-0">
            <label className="label">{t('Angle')}</label>
            <div className="flex items-center gap-2"><input type="number" min={0} max={360} step={1} className="input w-24" value={Math.round(value.angle * 100) / 100} onChange={(e) => set({ angle: Math.max(0, Math.min(360, Number(e.target.value) || 0)) })} data-theme-angle /><span className="text-sm text-text-2">°</span></div>
            <div className="mt-3 flex justify-between"><label className="label mb-0">{t('Tint strength')}</label><span className="text-xs text-text-2">{Math.round(value.midpoint)}</span></div>
            <input type="range" min={0} max={100} step={1} value={value.midpoint} onChange={(e) => set({ midpoint: Number(e.target.value) })} className="w-full accent-accent" data-theme-midpoint />
            <p className="text-xs text-text-2">{t('How strongly the colours tint the app. Lower is subtler.')}</p>
          </div>
        </div>
        <div>
          <label className="label">{t('Colours')}</label>
          <div className="space-y-2" data-theme-stops>
            {stops.map((s, i) => (
              <div key={i} className="flex items-center gap-2" data-theme-stop={i}>
                <input type="color" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} className="h-9 w-12 cursor-pointer rounded bg-transparent" aria-label={t('Colour {n}', { n: i + 1 })} data-theme-stop-color />
                <input className="input w-28 font-mono text-sm" value={s.color} onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) setStop(i, { color: v.toLowerCase() }) }} aria-label={t('Hex')} />
                <input type="range" min={0} max={100} step={0.5} value={s.pos} onChange={(e) => setStop(i, { pos: Number(e.target.value) })} className="flex-1 accent-accent" aria-label={t('Position')} data-theme-stop-pos />
                <span className="w-12 text-right text-xs text-text-2">{Math.round(s.pos)}%</span>
                <button type="button" onClick={() => set({ stops: stops.filter((_, j) => j !== i) })} disabled={stops.length <= 2} title={t('Remove colour')} aria-label={t('Remove colour')} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger disabled:opacity-30"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          {stops.length < 5 && <button type="button" onClick={() => set({ stops: [...stops, { color: stops[stops.length - 1]?.color ?? '#5865f2', pos: 100 }] })} className="mt-2 flex items-center gap-1 text-sm text-sky-400 hover:underline" data-theme-add-stop><Plus size={14} />{t('Add a colour')}</button>}
        </div>
        <div className="space-y-1" data-theme-contrast>
          {c.text0 < 4.5 && <Warn>{t('Body text only reaches {n}:1 on the strongest colour (WCAG AA needs 4.5:1).', { n: c.text0.toFixed(1) })}</Warn>}
          {c.text2 < 4.5 && <Warn>{t('Secondary text only reaches {n}:1 (WCAG AA needs 4.5:1). Try a subtler tint or softer colours.', { n: c.text2.toFixed(1) })}</Warn>}
          {adjusted.length > 0 && c.text2 >= 4.5 && <p className="text-xs text-text-2" data-theme-adjusted>{adjusted.includes('tint') ? t('The tint was eased off so text stays readable.') : t('Secondary text was brightened to stay readable.')}</p>}
          {c.text2 >= 4.5 && c.text0 >= 4.5 && <p className="text-xs text-success" data-theme-contrast-ok>{t('Text passes WCAG AA on every colour.')}</p>}
        </div>
      </div>
      <MiniApp look={value} />
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-1.5 text-xs text-warn" data-theme-warning><AlertTriangle size={14} className="mt-px shrink-0" />{children}</p>
}

/** A dial for the gradient's angle: drag the handle round (0° points up, like CSS). */
function AngleDial({ angle, onChange }: { angle: number; onChange: (a: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI
    onChange(Math.round(((a % 360) + 360) % 360))
  }
  return (
    <div ref={ref} role="slider" aria-label="Angle" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(angle)} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange((angle + 5) % 360); if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange((angle + 355) % 360) }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e) }} onPointerMove={(e) => { if (e.buttons) at(e) }}
      className="relative h-20 w-20 shrink-0 rounded-full border-2 border-line bg-bg-3 cursor-grab touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" data-theme-dial>
      <span className="absolute left-1/2 top-1/2 h-1/2 w-0.5 origin-top -translate-x-1/2 bg-accent" style={{ transform: `translateX(-50%) rotate(${angle + 180}deg)` }} />
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
    </div>
  )
}

/** The app in miniature, painted with the look's own variables: server bar, sidebar, chat and a message. */
export function MiniApp({ look, className = '', height = 180 }: { look: Look; className?: string; height?: number }) {
  const { vars } = themeVars(look)
  const style = { ...vars, background: gradientCss(look), height } as CSSProperties
  return (
    <div className={`self-start overflow-hidden rounded-xl border border-line text-[10px] ${className}`} style={style} data-theme-preview>
      <div className="flex h-full">
        <div className="w-8 bg-bg-0 flex flex-col items-center gap-1.5 py-2">{[0, 1, 2].map((i) => <span key={i} className="h-5 w-5 rounded-full bg-bg-4" />)}</div>
        <div className="w-20 bg-bg-1 p-1.5 space-y-1">
          <div className="h-3 rounded bg-bg-3" />
          {['general', 'random', 'voice'].map((n) => <div key={n} className="truncate text-text-2"># {n}</div>)}
        </div>
        <div className="flex-1 bg-bg-2 p-2 flex flex-col">
          <div className="text-text-0 font-semibold">Alex <span className="text-text-2 font-normal">12:04</span></div>
          <div className="text-text-1">Looks great in this theme!</div>
          <div className="mt-1.5 text-text-0 font-semibold">Sam <span className="text-text-2 font-normal">12:05</span></div>
          <div className="text-text-1">Agreed ✨</div>
          <div className="mt-auto h-5 rounded bg-bg-3 px-1.5 text-text-2 flex items-center">Message #general</div>
        </div>
      </div>
    </div>
  )
}
