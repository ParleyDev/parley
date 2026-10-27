import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import { usePrefs } from '../../../lib/prefs'
import { t, useT } from '../../../lib/i18n'

type Kind = 'username' | 'email' | 'password'

/** Username / Email / Password rows with their Edit dialogs (each asks for the current password); `only` picks rows. */
export function AccountChanges({ only = ['username', 'email', 'password'] }: { only?: Kind[] } = {}) {
  useT() // re-render when the language changes
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState<Kind | null>(null)
  const streamer = usePrefs().streamer && usePrefs().streamerHideInfo
  const [pending, setPending] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [logoutOthers, setLogoutOthers] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setValue(''); setPassword(''); setConfirm(''); setErr(null) }, [open])
  if (!user) return null
  const apply = (u: PrivateUser) => { if (token) setAuth(token, u) }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      if (open === 'username') { apply(await api.patch<PrivateUser>('/users/@me/username', { username: value, password })); pushToast(t('Username changed')) }
      else if (open === 'email') {
        const r = await api.post<{ pending: boolean; email: string; user?: PrivateUser }>('/users/@me/email', { email: value, password })
        if (r.pending) { setPending(r.email); pushToast(t('Check {email} for a confirmation link', { email: r.email })) } else if (r.user) { apply(r.user); pushToast(t('Email changed')) }
      } else if (open === 'password') {
        if (value !== confirm) { setErr(t('The new passwords do not match.')); setBusy(false); return }
        const r = await api.post<{ logged_out: number }>('/users/@me/password', { current_password: password, new_password: value, logout_others: logoutOthers })
        pushToast(r.logged_out ? (r.logged_out === 1 ? t('Password changed · 1 other device logged out') : t('Password changed · {n} other devices logged out', { n: r.logged_out })) : t('Password changed'))
      }
      setOpen(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  // Settings-window rows: the name on the left, the value and Edit on the right.
  const Row = ({ label, value, kind, hint }: { label: string; value: ReactNode; kind: Kind; hint?: string }) => (
    <div className="flex items-center gap-4 min-h-10" data-account-row={kind}>
      <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold text-text-0">{label}</div>{hint && <div className="text-xs text-text-2 mt-0.5">{hint}</div>}</div>
      <div className="min-w-0 truncate text-[15px] text-text-1" data-account-value={kind}>{value}</div>
      <button type="button" onClick={() => setOpen(kind)} className="h-10 shrink-0 rounded-lg bg-bg-3 hover:bg-bg-4 px-5 text-sm font-semibold text-text-0" data-account-edit={kind}>{t('Edit')}</button>
    </div>
  )
  return (
    <>
      <div className="space-y-5">
        {only.includes('username') && <Row label={t('Username')} value={user.username} kind="username" />}
        {only.includes('email') && <Row label={t('Email')} value={streamer ? <span data-streamer-masked title={t('Hidden by Streamer Mode')}>{user.email.replace(/^(.).*(@).*$/, '$1••••••$2••••••')}</span> : user.email} kind="email" hint={pending ? t('Waiting for you to confirm {email}', { email: pending }) : user.email_verified_at ? undefined : t('Not verified yet')} />}
        {only.includes('password') && <Row label={t('Password')} value="" kind="password" />}
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 safe-pad" onClick={() => !busy && setOpen(null)} data-account-dialog={open}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold">{open === 'username' ? t('Change your username') : open === 'email' ? t('Change your email') : t('Change your password')}</h3>
            <p className="text-sm text-text-2">
              {open === 'username' ? t('Letters, numbers, _ and . only; 2–32 characters. You can change it once a day.')
                : open === 'email' ? t('We will send a confirmation link to the new address. Nothing changes until you open it.')
                : t('Choose a new password of at least 8 characters.')}
            </p>
            {open === 'password' ? (
              <>
                <div><label className="label">{t('Current password')}</label><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required autoComplete="current-password" data-account-password /></div>
                <div><label className="label">{t('New password')}</label><input type="password" className="input" value={value} onChange={(e) => setValue(e.target.value)} required minLength={8} autoComplete="new-password" data-account-new /></div>
                <div><label className="label">{t('Confirm new password')}</label><input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" data-account-confirm /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={logoutOthers} onChange={(e) => setLogoutOthers(e.target.checked)} data-account-logout-others /> {t('Log out of all other devices')}</label>
              </>
            ) : (
              <>
                <div><label className="label">{open === 'username' ? t('New username') : t('New email')}</label><input type={open === 'email' ? 'email' : 'text'} className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus required maxLength={open === 'email' ? 254 : 32} data-account-new /></div>
                <div><label className="label">{t('Current password')}</label><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-account-password /></div>
              </>
            )}
            {err && <p className="text-sm text-danger" data-account-error>{err}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(null)} disabled={busy}>{t('Cancel')}</button><button className="btn-primary" disabled={busy} data-account-submit>{t('Done')}</button></div>
          </form>
        </div>
      )}
    </>
  )
}

interface Standing { level: 'all_good' | 'limited' | 'very_limited' | 'at_risk' | 'suspended'; actioned_reports: number; bans: number; active_timeouts: number; warnings?: number }
const levels = (): Record<Standing['level'], { title: string; blurb: string; color: string }> => ({
  all_good: { title: t('All good'), blurb: t('Your account has no recent moderation action against it.'), color: 'text-success' },
  limited: { title: t('Limited'), blurb: t('There has been some moderation action against your account recently. Keep to the server rules and this clears in 90 days.'), color: 'text-warn' },
  very_limited: { title: t('Very limited'), blurb: t('Repeated moderation action against your account. More could lead to a suspension.'), color: 'text-warn' },
  at_risk: { title: t('At risk'), blurb: t('Your account is close to being suspended because of repeated moderation action.'), color: 'text-danger' },
  suspended: { title: t('Suspended'), blurb: t('Your account has been suspended by an administrator.'), color: 'text-danger' },
})

/** Account standing card: a read of recent moderation action (resolved reports, bans, timeouts). */
export function StandingCard() {
  useT() // re-render when the language changes
  const [st, setSt] = useState<Standing | null>(null)
  useEffect(() => { api.get<Standing>('/users/@me/standing').then(setSt).catch(() => {}) }, [])
  if (!st) return null
  const l = levels()[st.level]
  const steps: Standing['level'][] = ['all_good', 'limited', 'very_limited', 'at_risk', 'suspended']
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-2" data-account-standing={st.level}>
      <div className="flex items-center gap-2">{st.level === 'all_good' ? <ShieldCheck size={18} className="text-success" /> : <ShieldAlert size={18} className={l.color} />}<h3 className="font-bold">{t('Account Standing')}</h3><span className={`ml-auto text-sm font-semibold ${l.color}`}>{l.title}</span></div>
      <div className="flex gap-1">{steps.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= steps.indexOf(st.level) ? (st.level === 'all_good' ? 'bg-success' : i >= 3 ? 'bg-danger' : 'bg-warn') : 'bg-bg-4'}`} />)}</div>
      <p className="text-sm text-text-2">{l.blurb}</p>
      {st.level !== 'all_good' && <p className="text-xs text-text-2">{st.actioned_reports === 1 ? t('1 actioned report in the last 90 days') : t('{n} actioned reports in the last 90 days', { n: st.actioned_reports })} · {st.bans === 1 ? t('1 server ban') : t('{n} server bans', { n: st.bans })} · {st.active_timeouts === 1 ? t('1 active timeout') : t('{n} active timeouts', { n: st.active_timeouts })} · {st.warnings === 1 ? t('1 warning') : t('{n} warnings', { n: st.warnings ?? 0 })}</p>}
    </section>
  )
}
