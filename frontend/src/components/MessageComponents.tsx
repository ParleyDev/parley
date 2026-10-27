import { ChevronDown, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Message } from '../lib/types'
import { useStore } from '../store'
import Emoji from './Emoji'
import { useT } from '../lib/i18n'

export interface Button { type: 2; style: 1 | 2 | 3 | 4 | 5; label?: string | null; emoji?: string | null; custom_id?: string | null; url?: string | null; disabled?: boolean }
export interface SelectOption { label: string; value: string; description?: string | null; emoji?: string | null; default?: boolean }
export interface Select { type: 3; custom_id: string; placeholder?: string | null; options: SelectOption[]; min_values: number; max_values: number; disabled?: boolean }
export interface ActionRow { type: 1; components: (Button | Select)[] }

const STYLE: Record<number, string> = { 1: 'bg-accent text-white hover:bg-accent/85', 2: 'bg-bg-4 text-text-0 hover:bg-bg-4/80', 3: 'bg-success text-black hover:bg-success/85', 4: 'bg-danger text-white hover:bg-danger/85', 5: 'bg-bg-4 text-text-0 hover:bg-bg-4/80' }

/** Buttons and select menus on a bot's message. Using one sends an interaction to the bot; it shows a spinner until
 * the bot answers (or 3 seconds pass). */
export default function MessageComponents({ m }: { m: Message }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [busy, setBusy] = useState<string | null>(null)
  // The bot answering (an update or a new message) clears the spinner; so does the 3-second limit.
  useEffect(() => { setBusy(null) }, [m.content, m.edited_at, m.components])
  useEffect(() => { if (!busy) return; const timer = setTimeout(() => setBusy(null), 3500); return () => clearTimeout(timer) }, [busy])
  const use = async (custom_id: string, values: string[] = []) => {
    setBusy(custom_id)
    try { await api.post('/interactions/component', { channel_id: m.channel_id, message_id: m.id, custom_id, values }) } catch (e) { setBusy(null); pushToast((e as Error).message, 'error') }
  }
  const rows = (m.components ?? []) as ActionRow[]
  return (
    <div className="mt-1.5 space-y-1.5" data-components>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          {row.components.map((c, j) => c.type === 2 ? (
            c.style === 5 ? (
              <a key={j} href={c.url ?? '#'} target="_blank" rel="noopener noreferrer" className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium ${STYLE[5]} ${c.disabled ? 'pointer-events-none opacity-50' : ''}`} data-component-link={c.label ?? ''}>
                {c.emoji && <Emoji value={c.emoji} size={16} />}{c.label}<ExternalLink size={13} />
              </a>
            ) : (
              <button key={j} type="button" disabled={c.disabled || !!busy} onClick={() => c.custom_id && use(c.custom_id)} className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium disabled:opacity-50 ${STYLE[c.style]}`} data-component-button={c.custom_id ?? ''}>
                {busy === c.custom_id ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label={t('Waiting for the app')} /> : c.emoji && <Emoji value={c.emoji} size={16} />}{c.label}
              </button>
            )
          ) : <SelectMenu key={j} s={c} busy={busy === c.custom_id} onPick={(v) => use(c.custom_id, v)} />)}
        </div>
      ))}
    </div>
  )
}

function SelectMenu({ s, busy, onPick }: { s: Select; busy: boolean; onPick: (values: string[]) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>(() => s.options.filter((o) => o.default).map((o) => o.value))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [open])
  const multi = s.max_values > 1
  const label = picked.length ? s.options.filter((o) => picked.includes(o.value)).map((o) => o.label).join(', ') : s.placeholder ?? t('Make a selection')
  const toggle = (v: string) => {
    if (!multi) { setPicked([v]); setOpen(false); onPick([v]); return }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : p.length < s.max_values ? [...p, v] : p))
  }
  return (
    <div ref={ref} className="relative w-full max-w-[400px]" data-component-select={s.custom_id}>
      <button type="button" disabled={s.disabled || busy} onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 rounded border border-line bg-bg-2 px-3 text-left text-sm disabled:opacity-50">
        <span className={`flex-1 truncate ${picked.length ? 'text-text-0' : 'text-text-2'}`}>{label}</span>
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-2 border-t-transparent" /> : <ChevronDown size={16} className="text-text-2" />}
      </button>
      {open && (
        <div className="pop absolute bottom-full left-0 z-40 mb-1 max-h-64 w-full overflow-y-auto rounded border border-line bg-bg-1 py-1 shadow-xl" role="listbox" aria-multiselectable={multi}>
          {s.options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={picked.includes(o.value)} onClick={() => toggle(o.value)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-3" data-select-option={o.value}>
              {multi && <input type="checkbox" readOnly checked={picked.includes(o.value)} className="mt-0.5 accent-accent" tabIndex={-1} />}
              {o.emoji && <Emoji value={o.emoji} size={16} />}
              <span className="min-w-0 flex-1"><span className="block">{o.label}</span>{o.description && <span className="block text-xs text-text-2">{o.description}</span>}</span>
            </button>
          ))}
          {multi && <div className="flex justify-end border-t border-line px-2 pt-1"><button type="button" className="btn-primary py-1 text-xs" disabled={picked.length < s.min_values} onClick={() => { setOpen(false); onPick(picked) }} data-select-done>{t('Done')}</button></div>}
        </div>
      )}
    </div>
  )
}
