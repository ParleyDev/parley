import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { FONT_SCALES, setAppearance, useAppearance, type Density, type Theme } from '../../../lib/appearance'
import { renderMarkdown } from '../../../lib/markdown'

const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
  { id: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { id: 'light', label: 'Light', icon: <Sun size={16} /> },
  { id: 'system', label: 'Sync with system', icon: <Monitor size={16} /> },
]

/** User Settings → Appearance: theme, chat font scale and message density. Stored per browser. */
export default function AppearanceTab() {
  const a = useAppearance()
  return (
    <div className="space-y-8" data-appearance>
      <div>
        <h2 className="text-xl font-bold">Appearance</h2>
        <p className="text-sm text-text-2 mt-1">These settings are saved in this browser.</p>
      </div>

      <section>
        <h3 className="label">Theme</h3>
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-2" data-theme-options>
          {THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => setAppearance({ theme: t.id })} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-left ${a.theme === t.id ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-theme-option={t.id} aria-pressed={a.theme === t.id}>
              {t.icon}<span className="flex-1">{t.label}</span>{a.theme === t.id && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">Chat font scaling</h3>
        <div className="rounded-xl border border-line bg-bg-2 p-4 mb-3" data-font-preview>
          <div className="flex gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-accent/40" />
            <div className="min-w-0">
              <div className="font-semibold leading-[1.375rem]">Preview <span className="text-[11px] text-text-2 font-normal">Today at 9:41</span></div>
              <div className="msg-content whitespace-pre-wrap">{renderMarkdown('Look at me, I\'m a **beautiful** message. ~~Nothing~~ *everything* scales.')}</div>
            </div>
          </div>
        </div>
        <input type="range" min={0} max={FONT_SCALES.length - 1} step={1} value={FONT_SCALES.indexOf(a.fontScale)} onChange={(e) => setAppearance({ fontScale: FONT_SCALES[Number(e.target.value)] })} className="w-full accent-accent" data-font-scale aria-label="Chat font scale" />
        <div className="flex justify-between text-xs text-text-2 mt-1">{FONT_SCALES.map((f) => <span key={f} className={f === a.fontScale ? 'text-text-0 font-semibold' : ''}>{f}%</span>)}</div>
      </section>

      <section>
        <h3 className="label">Message display</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2" data-density-options>
          {([['cozy', 'Cozy', 'Modern, beautiful, and easy on your eyes.'], ['compact', 'Compact', 'Fit more messages on screen at one time.']] as [Density, string, string][]).map(([id, label, desc]) => (
            <button key={id} type="button" onClick={() => setAppearance({ density: id })} className={`rounded-lg border px-3 py-2.5 text-left ${a.density === id ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`} data-density-option={id} aria-pressed={a.density === id}>
              <div className="text-sm font-semibold flex items-center justify-between">{label}{a.density === id && <Check size={16} className="text-accent" />}</div>
              <div className="text-xs text-text-2">{desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section data-accessibility>
        <h3 className="label">Accessibility</h3>
        <label className="flex items-center justify-between rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer">
          <span><span className="block text-sm font-semibold">Reduced motion</span><span className="block text-xs text-text-2">Turns off pop-ins, fades and pulses. Your system's reduce-motion setting is honoured either way.</span></span>
          <input type="checkbox" checked={a.reducedMotion} onChange={(e) => setAppearance({ reducedMotion: e.target.checked })} className="h-5 w-5 accent-accent" data-reduced-motion />
        </label>
        <label className="mt-2 flex items-center justify-between rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer">
          <span><span className="block text-sm font-semibold">High contrast</span><span className="block text-xs text-text-2">Brighter secondary text and borders.</span></span>
          <input type="checkbox" checked={a.highContrast} onChange={(e) => setAppearance({ highContrast: e.target.checked })} className="h-5 w-5 accent-accent" data-high-contrast />
        </label>
      </section>
    </div>
  )
}
