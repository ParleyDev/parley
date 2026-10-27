import { Check } from 'lucide-react'
import { coverage, LANGUAGES, setLanguage, useLanguage, useT, type Language, type Resolved } from '../../../lib/i18n'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { Toggle } from '../SettingsShell'

/** Settings → Language: pick the app language; shows how complete each translation is. */
export default function LanguageTab() {
  const t = useT()
  const language = useLanguage()
  const p = usePrefs()
  return (
    <div className="space-y-6" data-language-tab>
      <h2 className="text-xl font-bold">{t('Language')}</h2>
      <p className="text-sm text-text-2">{t('Applies immediately. Strings without a translation stay in English. Dates and numbers follow the chosen language.')}</p>
      <select className="sr-only" value={language} onChange={(e) => setLanguage(e.target.value as Language)} aria-label={t('Language')} data-language-select>
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2" data-language-options>
        {LANGUAGES.map((l) => { const pct = l.id === 'system' ? null : Math.round(coverage(l.id as Resolved) * 100); return (
          <button key={l.id} type="button" onClick={() => setLanguage(l.id)} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${language === l.id ? 'border-accent bg-accent/15 text-text-0' : 'border-line hover:bg-bg-3'}`} data-language={l.id}>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{l.id === 'system' ? t('Match system') : l.native}</span><span className="block text-xs text-text-2">{l.id === 'system' ? t('Follows your browser') : l.label}{pct !== null && pct < 100 ? ` · ${t('{pct}% translated', { pct })}` : ''}</span></span>
            {language === l.id && <Check size={16} className="text-accent" />}
          </button>
        ) })}
      </div>
      <div className="h-px bg-line" />
      <section className="space-y-2">
        <span data-spellcheck-toggle><Toggle label={t('Enable spellcheck')} checked={p.spellcheck} onChange={(v) => setPrefs({ spellcheck: v })} /></span>
        <p className="text-xs text-text-2">{t('Underlines misspelt words in the message box. Checks the languages set up in your {where}.', { where: /ParleyDesktop\//.test(navigator.userAgent) ? t('operating system') : t('browser') })}</p>
      </section>
    </div>
  )
}
