import { setPreview, usePreview } from '../lib/colorThemes'
import { setAppearance } from '../lib/appearance'
import { useT } from '../lib/i18n'

/** While a colour theme is being previewed: say so, and offer to keep it or go back, like Discord's preview bar. It
 *  floats above everything, settings included, since that's where previews start. */
export default function ThemePreviewBar() {
  const t = useT()
  const pv = usePreview()
  if (!pv) return null
  const apply = () => { setAppearance({ colorTheme: pv.id ?? 'custom' }); setPreview(null) }
  return (
    <div className="fixed bottom-5 left-1/2 z-[300] -translate-x-1/2 flex items-center gap-3 rounded-full bg-accent px-4 py-2 text-sm text-white shadow-2xl" role="status" data-theme-preview-bar>
      <span>{t('Previewing {name}', { name: pv.name })}</span>
      <button type="button" onClick={apply} className="rounded bg-white px-2.5 py-0.5 font-semibold text-accent hover:bg-white/90" data-theme-preview-apply>{t('Apply')}</button>
      <button type="button" onClick={() => setPreview(null)} className="rounded border border-white/60 px-2.5 py-0.5 font-semibold hover:bg-white/10" data-theme-preview-exit>{t('Exit Preview')}</button>
    </div>
  )
}
