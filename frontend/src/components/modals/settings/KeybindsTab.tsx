import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { comboOf, DEFAULT_KEYBINDS, KEYBIND_LABELS, prettyCombo, resetKeybinds, setKeybind, useKeybindMap, type KeybindAction } from '../../../lib/keybinds'
import { useT } from '../../../lib/i18n'

/** User Settings → Keybinds: see and rebind the app shortcuts. Stored per browser. */
export default function KeybindsTab() {
  const t = useT()
  const binds = useKeybindMap()
  const [recording, setRecording] = useState<KeybindAction | null>(null)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      if (e.key === 'Backspace' || e.key === 'Delete') { setKeybind(recording, null); setRecording(null); return }
      const combo = comboOf(e)
      if (!combo) return
      setKeybind(recording, combo); setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])
  const actions = Object.keys(KEYBIND_LABELS) as KeybindAction[]
  return (
    <div className="space-y-6" data-keybinds>
      <div>
        <h1 className="text-xl font-bold">{t('Keybinds')}</h1>
        <p className="text-sm text-text-2 mt-1">{t('Click a shortcut, then press the keys you want. Esc cancels, Backspace clears. Plain keys stay out of the way while you type; combos with Ctrl or Alt always work.')}</p>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 divide-y divide-line">
        {actions.map((a) => (
          <div key={a} className="flex items-center gap-3 px-4 py-2.5" data-keybind={a}>
            <span className="flex-1 text-sm">{t(KEYBIND_LABELS[a])}</span>
            <button type="button" onClick={() => setRecording(a)} className={`min-w-[150px] rounded-md border px-3 py-1 text-sm font-mono ${recording === a ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-0 text-text-1 hover:border-text-2'}`} data-keybind-combo aria-label={`${t(KEYBIND_LABELS[a])}: ${prettyCombo(binds[a])}`}>
              {recording === a ? t('Press keys…') : prettyCombo(binds[a])}
            </button>
            {binds[a] !== DEFAULT_KEYBINDS[a] && <button type="button" onClick={() => setKeybind(a, DEFAULT_KEYBINDS[a])} title={t('Reset to default')} className="text-text-2 hover:text-text-0" data-keybind-reset><RotateCcw size={14} /></button>}
          </div>
        ))}
      </div>
      <button type="button" className="btn-ghost" onClick={resetKeybinds} data-keybinds-reset-all>{t('Reset all to defaults')}</button>
    </div>
  )
}
