import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { STORAGE_PREFIX } from '../lib/brand'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** First-run checklist on the Friends page: a few steps to get going, ticked off as they happen. Dismissable. */
export default function GettingStarted({ onAddFriend }: { onAddFriend: () => void }) {
  const t = useT()
  const user = useStore((s) => s.user)
  const hasFriend = useStore((s) => Object.values(s.relationships).some((r) => r.kind === 'friend' || r.kind === 'outgoing'))
  const hasServer = useStore((s) => s.guildOrder.length > 0)
  const openModal = useStore((s) => s.openModal)
  const key = `${STORAGE_PREFIX}gettingStarted.${user?.id}`
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === 'done' } catch { return false } })
  if (!user || hidden) return null
  const steps = [
    { id: 'avatar', label: t('Add a profile picture'), done: !!user.avatar_url, go: () => openModal({ kind: 'editProfile' }) },
    { id: 'friend', label: t('Add a friend'), done: hasFriend, go: onAddFriend },
    { id: 'server', label: t('Join or create a server'), done: hasServer, go: () => openModal({ kind: 'createGuild' }) },
    { id: 'status', label: t('Set a custom status'), done: !!user.custom_status, go: () => openModal({ kind: 'customStatus' }) },
    { id: 'mfa', label: t('Turn on two-factor authentication'), done: !!user.mfa_enabled, go: () => openModal({ kind: 'userSettings', tab: 'account' }) },
  ]
  const left = steps.filter((s) => !s.done).length
  if (left === 0) return null
  const dismiss = () => { try { localStorage.setItem(key, 'done') } catch { /* ignore */ } setHidden(true) }
  return (
    <section className="mb-5 rounded-xl border border-line bg-bg-1 p-4" aria-label={t('Getting started')} data-getting-started={left}>
      <div className="flex items-center gap-2">
        <h3 className="font-bold">{t('Getting started')}</h3>
        <span className="text-xs text-text-2">{t('{done} of {total} done', { done: steps.length - left, total: steps.length })}</span>
        <button type="button" onClick={dismiss} className="ml-auto text-text-2 hover:text-text-0" title={t('Dismiss')} aria-label={t('Dismiss getting started')} data-getting-started-dismiss><X size={16} /></button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-3"><div className="h-full bg-success transition-all" style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      <ul className="mt-3 grid grid-cols-2 max-md:grid-cols-1 gap-1.5">
        {steps.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={s.done} onClick={s.go} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${s.done ? 'text-text-2 line-through' : 'text-text-0 hover:bg-bg-3'}`} data-getting-started-step={s.id} data-done={s.done ? '1' : '0'}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${s.done ? 'border-success bg-success text-black' : 'border-text-2'}`}>{s.done && <Check size={12} />}</span>{s.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
