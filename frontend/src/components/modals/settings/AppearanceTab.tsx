import { useState } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { setSyncEnabled, syncEnabled } from '../../../lib/settingsSync'
import { FONT_SCALES, PALETTES, resolvedTheme, setAppearance, useAppearance, type Density, type Theme, type UiDensity } from '../../../lib/appearance'
import { renderMarkdown } from '../../../lib/markdown'
import { t, useT } from '../../../lib/i18n'
import { ACCENTS, setPrefs, usePrefs } from '../../../lib/prefs'
import { Toggle } from '../SettingsShell'
import { APP_ICONS, iconUrl } from '../../../lib/appIcon'

const themes = (): { id: Theme; label: string; icon: React.ReactNode }[] => [
  { id: 'dark', label: t('Dark'), icon: <Moon size={16} /> },
  { id: 'light', label: t('Light'), icon: <Sun size={16} /> },
  { id: 'system', label: t('Sync with system'), icon: <Monitor size={16} /> },
]

/** User Settings → Appearance: theme, chat font scale and message density. Stored per browser. */
export default function AppearanceTab() {
  const t = useT()
  const a = useAppearance()
  const p = usePrefs()
  const [sync, setSync] = useState(syncEnabled)
  return (
    <div className="space-y-8" data-appearance>
      <div>
        <h2 className="text-xl font-bold">{t('Appearance')}</h2>
        <p className="text-sm text-text-2 mt-1">{t('Saved on your account when sync is on (below), otherwise in this browser.')}</p>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer" data-sync-row>
        <span><span className="block text-sm font-semibold">{t('Sync settings across devices')}</span><span className="block text-xs text-text-2">{t('Appearance, chat and accessibility options, sounds and keybinds follow your account.')}</span></span>
        <input type="checkbox" className="h-5 w-5 accent-accent" checked={sync} onChange={(e) => { setSyncEnabled(e.target.checked); setSync(e.target.checked) }} data-sync-settings />
      </label>

      <section>
        <h3 className="label">{t('Theme')}</h3>
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-2" data-theme-options>
          {themes().map((th) => (
            <button key={th.id} type="button" onClick={() => setAppearance({ theme: th.id })} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-left ${a.theme === th.id ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-theme-option={th.id} aria-pressed={a.theme === th.id}>
              {th.icon}<span className="flex-1">{th.label}</span>{a.theme === th.id && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">{t('Dark theme colours')}</h3>
        <div className={`flex flex-wrap gap-3 ${resolvedTheme(a) === 'light' ? 'opacity-50' : ''}`} data-palette-options>
          {PALETTES.map((x) => (
            <button key={x.id} type="button" onClick={() => setAppearance({ palette: x.id })} className="flex flex-col items-center gap-1 text-xs" data-palette-option={x.id} aria-pressed={a.palette === x.id} title={x.label}>
              <span className={`h-12 w-12 rounded-full border-2 ${a.palette === x.id ? 'border-accent' : 'border-line'}`} style={{ background: x.swatch }} />
              <span className={a.palette === x.id ? 'text-text-0 font-semibold' : 'text-text-2'}>{x.label}</span>
            </button>
          ))}
        </div>
        {resolvedTheme(a) === 'light' && <p className="mt-2 text-xs text-text-2">{t('These apply when the dark theme is showing.')}</p>}
      </section>

      <AppIconPicker />

      <section>
        <h3 className="label">{t('Accent colour')}</h3>
        <div className="flex flex-wrap items-center gap-2" data-accent-options>
          <button type="button" onClick={() => setPrefs({ accent: null })} className={`h-8 rounded-md border px-2 text-xs ${p.accent === null ? 'border-white' : 'border-transparent'} bg-bg-3`} data-accent="default">{t('Theme default')}</button>
          {ACCENTS.map((c) => <button key={c} type="button" onClick={() => setPrefs({ accent: c })} title={c} className={`h-8 w-8 rounded-md border-2 ${p.accent === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} data-accent={c} />)}
          <label className="flex items-center gap-2 text-xs text-text-2">{t('Custom')} <input type="color" value={p.accent ?? '#6d5dfc'} onChange={(e) => setPrefs({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded bg-transparent" data-accent-custom /></label>
        </div>
      </section>

      <section>
        <h3 className="label">{t('Chat font scaling')}</h3>
        <div className="rounded-xl border border-line bg-bg-2 p-4 mb-3" data-font-preview>
          <div className="flex gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-accent/40" />
            <div className="min-w-0">
              <div className="font-semibold leading-[1.375rem]">{t('Preview')} <span className="text-[11px] text-text-2 font-normal">{t('Today at 9:41')}</span></div>
              <div className="msg-content whitespace-pre-wrap">{renderMarkdown(t('Look at me, I\'m a **beautiful** message. ~~Nothing~~ *everything* scales.'))}</div>
            </div>
          </div>
        </div>
        <input type="range" min={0} max={FONT_SCALES.length - 1} step={1} value={FONT_SCALES.indexOf(a.fontScale)} onChange={(e) => setAppearance({ fontScale: FONT_SCALES[Number(e.target.value)] })} className="w-full accent-accent" data-font-scale aria-label={t('Chat font scale')} />
        <div className="flex justify-between text-xs text-text-2 mt-1">{FONT_SCALES.map((f) => <span key={f} className={f === a.fontScale ? 'text-text-0 font-semibold' : ''}>{f}%</span>)}</div>
      </section>

      <section>
        <h3 className="label">{t('Message display')}</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2" data-density-options>
          {([['cozy', t('Cozy'), t('Modern, beautiful, and easy on your eyes.')], ['compact', t('Compact'), t('Fit more messages on screen at one time.')]] as [Density, string, string][]).map(([id, label, desc]) => (
            <button key={id} type="button" onClick={() => setAppearance({ density: id })} className={`rounded-lg border px-3 py-2.5 text-left ${a.density === id ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`} data-density-option={id} aria-pressed={a.density === id}>
              <div className="text-sm font-semibold flex items-center justify-between">{label}{a.density === id && <Check size={16} className="text-accent" />}</div>
              <div className="text-xs text-text-2">{desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">{t('UI density')}</h3>
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-2" data-ui-density-options>
          {([['compact', t('Compact')], ['default', t('Default')], ['spacious', t('Spacious')]] as [UiDensity, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setAppearance({ uiDensity: id })} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${a.uiDensity === id ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-ui-density-option={id} aria-pressed={a.uiDensity === id}>
              {label}{a.uiDensity === id && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-text-2">{t('How much room the channel, DM and member lists get.')}</p>
      </section>

      <section>
        <div className="flex justify-between"><h3 className="label">{t('Space between message groups')}</h3><span className="text-xs text-text-2">{p.messageGap}px</span></div>
        <input type="range" min={0} max={24} step={1} value={p.messageGap} onChange={(e) => setPrefs({ messageGap: Number(e.target.value) })} className="w-full accent-accent" data-message-gap />
      </section>

      <section>
        <div className="flex justify-between"><h3 className="label">{t('Zoom level')}</h3><span className="text-xs text-text-2">{p.zoom}%</span></div>
        <input type="range" min={50} max={200} step={10} value={p.zoom} onChange={(e) => setPrefs({ zoom: Number(e.target.value) })} className="w-full accent-accent" data-zoom />
        <p className="text-xs text-text-2 mt-1">{t('Scales the whole app (Ctrl + / Ctrl − in the browser does too).')}</p>
      </section>

      <section className="space-y-3">
        <Toggle label={t('Show avatars in compact mode')} checked={p.compactAvatars} onChange={(v) => setPrefs({ compactAvatars: v })} />
        <div>
          <h3 className="label">{t('Role colours')}</h3>
          <div className="flex gap-2" data-role-color-options>
            {([['name', t('In names')], ['next', t('Next to names')], ['off', t('Off')]] as const).map(([v, label]) => <button key={v} type="button" onClick={() => setPrefs({ roleColors: v })} className={`rounded-md border px-3 py-1.5 text-sm ${p.roleColors === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-role-colors={v}>{label}</button>)}
          </div>
        </div>
      </section>


      <p className="text-xs text-text-2">{t('Reduced motion and high contrast moved to the Accessibility tab.')}</p>
    </div>
  )
}

/** App icon: the tab icon (and the desktop app's window, taskbar and tray icon). */
function AppIconPicker() {
  const t = useT()
  const cur = usePrefs().appIcon
  return (
    <section data-app-icons>
      <h3 className="label">{t('App icon')}</h3>
      <div className="flex flex-wrap gap-3">
        {APP_ICONS.map((i) => (
          <button key={i.id} type="button" onClick={() => setPrefs({ appIcon: i.id })} className="flex flex-col items-center gap-1 text-xs" data-app-icon={i.id} aria-pressed={cur === i.id} title={t(i.label)}>
            <span className={`h-14 w-14 rounded-2xl border-2 p-0.5 ${cur === i.id ? 'border-accent' : 'border-transparent'}`}><img src={iconUrl(i)} alt="" className="h-full w-full" /></span>
            <span className={cur === i.id ? 'text-text-0 font-semibold' : 'text-text-2'}>{t(i.label)}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-2">{t('Changes the icon in your browser tab, and in the desktop app the window, taskbar and tray icon. An installed web app keeps the icon it was installed with.')}</p>
    </section>
  )
}
