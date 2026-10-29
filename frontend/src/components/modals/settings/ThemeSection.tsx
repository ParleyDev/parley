import { useState } from 'react'
import { Check, Eye, Palette as PaletteIcon, Pencil } from 'lucide-react'
import { getAppearance, resolvedTheme, setAppearance, useAppearance, type Palette } from '../../../lib/appearance'
import { setPreview, useColorThemes, type ColorTheme, type Look } from '../../../lib/colorThemes'
import { useT } from '../../../lib/i18n'
import { Toggle } from '../SettingsShell'
import ThemeEditor, { ThemeSwatch } from '../../ThemeEditor'

const STARTER: Look = { base: 'dark', angle: 150, midpoint: 40, stops: [{ color: '#5865f2', pos: 10 }, { color: '#eb459e', pos: 90 }] }
const lookOfTheme = (t: ColorTheme): Look => ({ base: t.base, angle: t.angle, midpoint: t.midpoint, stops: t.stops })

/**
 * Appearance → Theme, laid out like Discord's: follow the device, the default themes (Light, Ash, Dark, Onyx and
 * Midnight), the colour themes (every enabled one, free for everyone), your own custom theme, and how themes behave:
 * synced across devices, shown on other people's profiles, and inside servers that have their own.
 */
export default function ThemeSection() {
  const t = useT()
  const a = useAppearance()
  const themes = useColorThemes()
  const [building, setBuilding] = useState(false)
  const base = resolvedTheme(a)
  const defaults: { id: string; label: string; swatch: string; pick: () => void; on: boolean }[] = [
    { id: 'light', label: t('Light'), swatch: '#ffffff', pick: () => setAppearance({ theme: 'light', colorTheme: null }), on: !a.colorTheme && a.theme === 'light' },
    ...([['ash', t('Ash'), '#313338'], ['default', t('Dark'), '#1a1b23'], ['onyx', t('Onyx'), '#0f0f11'], ['midnight', t('Midnight'), '#121a2c']] as [Palette, string, string][]).map(([p, label, swatch]) => ({
      id: p, label, swatch, pick: () => setAppearance({ theme: a.theme === 'system' ? 'system' : 'dark', palette: p, colorTheme: null }), on: !a.colorTheme && base === 'dark' && a.palette === p,
    })),
  ]
  return (
    <section className="space-y-5" data-theme-section>
      <h3 className="label">{t('Theme')}</h3>
      <Toggle label="Same as device theme" checked={a.theme === 'system'} onChange={(v) => setAppearance({ theme: v ? 'system' : base })} />
      <div>
        <div className="mb-2 text-sm font-semibold">{t('Default Themes')}</div>
        <div className="flex flex-wrap gap-4" data-default-themes>
          {defaults.map((d) => (
            <button key={d.id} type="button" onClick={d.pick} aria-pressed={d.on} className="flex flex-col items-center gap-1 text-xs" data-default-theme={d.id} title={d.label}>
              <span className={`relative h-12 w-12 rounded-full border-2 ${d.on ? 'border-accent ring-2 ring-accent/40' : 'border-line'}`} style={{ background: d.swatch }}>{d.on && <Check size={16} className="absolute -right-1 -top-1 rounded-full bg-accent p-0.5 text-white" />}</span>
              <span className={d.on ? 'text-text-0 font-semibold' : 'text-text-2'}>{d.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">{t('Color Themes')}</span><span className="text-xs text-text-2">{t('Free for everyone. Preview one before you pick it.')}</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-3" data-color-themes>
          {themes.map((th) => {
            const on = a.colorTheme === th.id
            return (
              <div key={th.id} className="group relative flex flex-col items-center gap-1 text-[11px]" data-color-theme-option={th.slug}>
                <button type="button" onClick={() => { setPreview(null); setAppearance({ colorTheme: th.id }) }} aria-pressed={on} title={th.name} className="flex flex-col items-center gap-1" data-color-theme-pick={th.id}>
                  <span className="relative"><ThemeSwatch look={lookOfTheme(th)} size={52} selected={on} />{on && <Check size={16} className="absolute -right-1 -top-1 rounded-full bg-accent p-0.5 text-white" />}</span>
                  <span className={`max-w-[72px] truncate ${on ? 'text-text-0 font-semibold' : 'text-text-2'}`}>{th.name}</span>
                </button>
                <button type="button" onClick={() => setPreview({ look: lookOfTheme(th), name: th.name, id: th.id })} title={t('Preview Theme')} aria-label={t('Preview {name}', { name: th.name })} className="absolute right-0 top-0 hidden h-6 w-6 items-center justify-center rounded-full bg-bg-1/90 text-text-1 shadow group-hover:flex focus:flex" data-color-theme-preview={th.id}><Eye size={13} /></button>
              </div>
            )
          })}
          <div className="flex flex-col items-center gap-1 text-[11px]" data-color-theme-option="custom">
            <button type="button" onClick={() => { if (!a.customTheme) setAppearance({ customTheme: STARTER }); setBuilding(true) }} className="flex flex-col items-center gap-1" title={t('Your own theme')} data-custom-theme-open>
              <span className="relative">{a.customTheme ? <ThemeSwatch look={a.customTheme} size={52} selected={a.colorTheme === 'custom'} /> : <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-dashed border-line text-text-2"><PaletteIcon size={20} /></span>}{a.colorTheme === 'custom' && <Check size={16} className="absolute -right-1 -top-1 rounded-full bg-accent p-0.5 text-white" />}</span>
              <span className={a.colorTheme === 'custom' ? 'text-text-0 font-semibold' : 'text-text-2'}>{t('Custom')}</span>
            </button>
          </div>
        </div>
        {a.colorTheme && <button type="button" onClick={() => setAppearance({ colorTheme: null })} className="mt-3 text-xs text-sky-400 hover:underline" data-color-theme-clear>{t('Use a default theme instead')}</button>}
      </div>
      {building && a.customTheme && (
        <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-custom-theme-builder>
          <div className="flex items-center gap-2"><Pencil size={15} className="text-text-2" /><span className="font-semibold">{t('Your custom theme')}</span><span className="text-xs text-text-2">{t('Saved with your settings')}</span></div>
          <ThemeEditor value={a.customTheme} onChange={(l) => setAppearance({ customTheme: l })} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => { setAppearance({ colorTheme: 'custom' }); setBuilding(false) }} data-custom-theme-use>{t('Use this theme')}</button>
            <button type="button" className="btn-ghost" onClick={() => setPreview({ look: getAppearance().customTheme!, name: t('Custom') })} data-custom-theme-preview>{t('Preview Theme')}</button>
            <button type="button" className="btn-ghost" onClick={() => setBuilding(false)}>{t('Close')}</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        <Toggle label="Sync theme across my devices" checked={a.syncTheme} onChange={(v) => setAppearance({ syncTheme: v })} />
        <Toggle label="Apply theme to other users' profiles" checked={a.profileThemes} onChange={(v) => setAppearance({ profileThemes: v })} />
        <div>
          <div className="text-[15px] mb-1.5">{t('Default theme in servers')}</div>
          <div className="flex gap-2" data-server-theme-pref>
            {([['server', t("Use the server's theme")], ['mine', t('Use mine')]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setAppearance({ serverThemes: v })} aria-pressed={a.serverThemes === v} className={`rounded-md border px-3 py-1.5 text-sm ${a.serverThemes === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-server-theme-pref-option={v}>{label}</button>
            ))}
          </div>
        </div>
        {(a.highContrast || a.reducedMotion) && <p className="text-xs text-text-2" data-theme-overridden>{t('High contrast or reduced motion is on, so colour themes show as their plain base.')}</p>}
      </div>
    </section>
  )
}
