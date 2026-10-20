import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { FONT_SCALES, setAppearance, useAppearance, type Density, type Theme } from '../../../lib/appearance'
import { renderMarkdown } from '../../../lib/markdown'
import { LANGUAGES, setLanguage, useLanguage, useT, type Language } from '../../../lib/i18n'
import { ACCENTS, setPrefs, usePrefs } from '../../../lib/prefs'
import { Toggle } from '../SettingsShell'

const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
  { id: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { id: 'light', label: 'Light', icon: <Sun size={16} /> },
  { id: 'system', label: 'Sync with system', icon: <Monitor size={16} /> },
]

/** User Settings → Appearance: theme, chat font scale and message density. Stored per browser. */
export default function AppearanceTab() {
  const t = useT()
  const language = useLanguage()
  const a = useAppearance()
  const p = usePrefs()
  return (
    <div className="space-y-8" data-appearance>
      <div>
        <h2 className="text-xl font-bold">Appearance</h2>
        <p className="text-sm text-text-2 mt-1">These settings are saved in this browser.</p>
      </div>

      <section>
        <h3 className="label">{t('Theme')}</h3>
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-2" data-theme-options>
          {THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => setAppearance({ theme: t.id })} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-left ${a.theme === t.id ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-theme-option={t.id} aria-pressed={a.theme === t.id}>
              {t.icon}<span className="flex-1">{t.label}</span>{a.theme === t.id && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">Accent colour</h3>
        <div className="flex flex-wrap items-center gap-2" data-accent-options>
          <button type="button" onClick={() => setPrefs({ accent: null })} className={`h-8 rounded-md border px-2 text-xs ${p.accent === null ? 'border-white' : 'border-transparent'} bg-bg-3`} data-accent="default">Theme default</button>
          {ACCENTS.map((c) => <button key={c} type="button" onClick={() => setPrefs({ accent: c })} title={c} className={`h-8 w-8 rounded-md border-2 ${p.accent === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} data-accent={c} />)}
          <label className="flex items-center gap-2 text-xs text-text-2">Custom <input type="color" value={p.accent ?? '#6d5dfc'} onChange={(e) => setPrefs({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded bg-transparent" data-accent-custom /></label>
        </div>
      </section>

      <section>
        <h3 className="label">{t('Chat font scaling')}</h3>
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
        <h3 className="label">{t('Message display')}</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2" data-density-options>
          {([['cozy', 'Cozy', 'Modern, beautiful, and easy on your eyes.'], ['compact', 'Compact', 'Fit more messages on screen at one time.']] as [Density, string, string][]).map(([id, label, desc]) => (
            <button key={id} type="button" onClick={() => setAppearance({ density: id })} className={`rounded-lg border px-3 py-2.5 text-left ${a.density === id ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`} data-density-option={id} aria-pressed={a.density === id}>
              <div className="text-sm font-semibold flex items-center justify-between">{label}{a.density === id && <Check size={16} className="text-accent" />}</div>
              <div className="text-xs text-text-2">{desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="flex justify-between"><h3 className="label">Space between message groups</h3><span className="text-xs text-text-2">{p.messageGap}px</span></div>
        <input type="range" min={0} max={24} step={1} value={p.messageGap} onChange={(e) => setPrefs({ messageGap: Number(e.target.value) })} className="w-full accent-accent" data-message-gap />
      </section>

      <section>
        <div className="flex justify-between"><h3 className="label">Zoom level</h3><span className="text-xs text-text-2">{p.zoom}%</span></div>
        <input type="range" min={50} max={200} step={10} value={p.zoom} onChange={(e) => setPrefs({ zoom: Number(e.target.value) })} className="w-full accent-accent" data-zoom />
        <p className="text-xs text-text-2 mt-1">Scales the whole app (Ctrl + / Ctrl − in the browser does too).</p>
      </section>

      <section className="space-y-3">
        <Toggle label="Show avatars in compact mode" checked={p.compactAvatars} onChange={(v) => setPrefs({ compactAvatars: v })} />
        <div>
          <h3 className="label">Role colours</h3>
          <div className="flex gap-2" data-role-color-options>
            {([['name', 'In names'], ['next', 'Next to names'], ['off', 'Off']] as const).map(([v, label]) => <button key={v} type="button" onClick={() => setPrefs({ roleColors: v })} className={`rounded-md border px-3 py-1.5 text-sm ${p.roleColors === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-role-colors={v}>{label}</button>)}
          </div>
        </div>
      </section>

      <section data-language>
        <h3 className="label">{t('Language')}</h3>
        <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as Language)} data-language-select>
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <p className="text-xs text-text-2 mt-1">Applies immediately. Strings without a translation stay in English.</p>
      </section>

      <p className="text-xs text-text-2">Reduced motion and high contrast moved to the Accessibility tab.</p>
    </div>
  )
}
