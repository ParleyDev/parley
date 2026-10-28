import { AlertTriangle, CalendarClock, Check, ExternalLink, Server, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { locale, useT } from '../lib/i18n'
import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'

interface Blockers { guilds: { id: string; name: string; icon_url: string | null }[]; apps: { id: string; name: string }[]; sole_admin: boolean }

/**
 * Deleting your account, step by step (Settings › Account and the public /delete-account page): what happens and
 * anything to sort out first (servers and apps you own), your password (and 2FA code) again, a confirmation with the
 * date it becomes final, then done. `onDone` runs after the request; the session is already gone by then.
 */
export default function DeleteAccountFlow({ onCancel, onDone, onManage }: { onCancel?: () => void; onDone: (scheduledFor: string) => void; onManage?: (what: { guildId?: string; apps?: boolean }) => void }) {
  const t = useT()
  const user = useStore((s) => s.user)
  const [info, setInfo] = useState<{ grace_days: number; blockers: Blockers } | null>(null)
  const [step, setStep] = useState<'intro' | 'auth' | 'confirm'>('intro')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<{ grace_days: number; blockers: Blockers }>('/users/@me/deletion').then(setInfo).catch((e) => setErr((e as Error).message)) }, [])
  if (!user) return null
  const days = info?.grace_days ?? 14
  const when = new Date(Date.now() + days * 86400000).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' })
  const b = info?.blockers
  const blocked = !!b && (b.guilds.length > 0 || b.apps.length > 0 || b.sole_admin)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api.post<{ scheduled_for: string }>('/users/@me/deletion', { password, code: user.mfa_enabled ? code : undefined })
      onDone(r.scheduled_for)
    } catch (e) { setErr((e as Error).message); setStep('auth'); setBusy(false) }
  }
  const danger = 'rounded-lg bg-danger hover:brightness-110 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
  return (
    <div className="space-y-4" data-delete-flow={step}>
      {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-delete-error>{err}</div>}

      {step === 'intro' && (
        <>
          <div className="space-y-3 text-sm text-text-1">
            <p className="flex gap-2"><CalendarClock size={18} className="shrink-0 text-text-2" />{t('Your account is scheduled for deletion and disappears from Parley right away. You have {n} days to change your mind: just sign in again and choose Restore.', { n: days })}</p>
            <p className="flex gap-2"><Trash2 size={18} className="shrink-0 text-text-2" />{t('After that, your email, password, profile, avatar and banner, connections, notes, friends and settings are erased for good, and your files are removed.')}</p>
            <p className="flex gap-2"><Check size={18} className="shrink-0 text-text-2" />{t('Messages you sent stay where they are, shown as from "Deleted User", so conversations still make sense. Delete any you want gone before you go.')}</p>
          </div>
          {!info ? <p className="text-sm text-text-2">{t('Loading…')}</p> : blocked && (
            <div className="rounded-lg border border-warn/50 bg-warn/10 p-3 space-y-2" data-delete-blockers>
              <div className="flex items-center gap-2 font-semibold text-sm"><AlertTriangle size={16} className="text-warn" />{t('First, sort these out')}</div>
              {b!.sole_admin && <p className="text-sm">{t("You're this instance's only admin. Make someone else an admin first.")}</p>}
              {b!.guilds.length > 0 && (
                <div>
                  <p className="text-sm mb-1">{t('Transfer ownership of these servers, or delete them:')}</p>
                  <ul className="space-y-1">{b!.guilds.map((g) => (
                    <li key={g.id} className="flex items-center gap-2 text-sm" data-delete-blocker-guild={g.id}>
                      <span className="h-6 w-6 rounded-md overflow-hidden shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>{g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" /> : initials(g.name)}</span>
                      <span className="flex-1 truncate">{g.name}</span>
                      {onManage && <button type="button" onClick={() => onManage({ guildId: g.id })} className="text-accent hover:underline text-xs flex items-center gap-1"><Server size={12} />{t('Server Settings')}</button>}
                    </li>
                  ))}</ul>
                </div>
              )}
              {b!.apps.length > 0 && (
                <p className="text-sm flex flex-wrap items-center gap-x-2">{t('Delete the apps you own: {names}', { names: b!.apps.map((a) => a.name).join(', ') })}
                  {onManage && <button type="button" onClick={() => onManage({ apps: true })} className="text-accent hover:underline text-xs flex items-center gap-1"><ExternalLink size={12} />{t('Applications')}</button>}</p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>}
            <button type="button" className={danger} disabled={!info || blocked} onClick={() => setStep('auth')} data-delete-continue>{t('Continue')}</button>
          </div>
        </>
      )}

      {step === 'auth' && (
        <form onSubmit={(e) => { e.preventDefault(); setErr(null); setStep('confirm') }} className="space-y-3" data-delete-form>
          <p className="text-sm text-text-1">{t('To make sure it’s you, enter your password{mfa}.', { mfa: user.mfa_enabled ? t(' and a two-factor code') : '' })}</p>
          <div><label className="label">{t('Password')}</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-delete-password /></div>
          {user.mfa_enabled && <div><label className="label">{t('Two-factor code')}</label><input className="input max-w-[200px] tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-delete-code /></div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep('intro')}>{t('Back')}</button>
            <button className={danger} disabled={!password || (user.mfa_enabled && !code)} data-delete-next>{t('Continue')}</button>
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <form onSubmit={submit} className="space-y-4" data-delete-confirm-step>
          <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm space-y-1">
            <div className="font-semibold text-text-0">{t('Delete {name}?', { name: user.username })}</div>
            <div>{t('Your account will be deleted for good on {date}. Until then, signing in lets you restore it.', { date: when })}</div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-danger" checked={sure} onChange={(e) => setSure(e.target.checked)} data-delete-confirm /> {t('I understand my account will be deleted and can’t be recovered after that date.')}</label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep('auth')} disabled={busy}>{t('Back')}</button>
            <button className={danger} disabled={busy || !sure} data-delete-submit>{busy ? t('Deleting…') : t('Delete my account')}</button>
          </div>
        </form>
      )}
    </div>
  )
}

/** After the request: when it becomes final, and how to undo it. */
export function DeletionScheduled({ at }: { at: string }) {
  const t = useT()
  const date = new Date(at).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="space-y-2 text-sm" data-delete-scheduled={at}>
      <p className="font-semibold text-text-0">{t('Your account is scheduled for deletion on {date}.', { date })}</p>
      <p className="text-text-1">{t('You’ve been signed out everywhere. Changed your mind? Sign in before then and choose Restore.')}</p>
    </div>
  )
}
