import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import { usePrefs } from '../../../lib/prefs'

type Kind = 'username' | 'email' | 'password'

/** Username / Email / Password rows with their Edit dialogs (each asks for the current password). */
export function AccountChanges() {
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
      if (open === 'username') { apply(await api.patch<PrivateUser>('/users/@me/username', { username: value, password })); pushToast('Username changed') }
      else if (open === 'email') {
        const r = await api.post<{ pending: boolean; email: string; user?: PrivateUser }>('/users/@me/email', { email: value, password })
        if (r.pending) { setPending(r.email); pushToast(`Check ${r.email} for a confirmation link`) } else if (r.user) { apply(r.user); pushToast('Email changed') }
      } else if (open === 'password') {
        if (value !== confirm) { setErr('The new passwords do not match.'); setBusy(false); return }
        const r = await api.post<{ logged_out: number }>('/users/@me/password', { current_password: password, new_password: value, logout_others: logoutOthers })
        pushToast(r.logged_out ? `Password changed · ${r.logged_out} other device${r.logged_out === 1 ? '' : 's'} logged out` : 'Password changed')
      }
      setOpen(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const Row = ({ label, value, kind, hint }: { label: string; value: ReactNode; kind: Kind; hint?: string }) => (
    <div className="flex items-center gap-3" data-account-row={kind}>
      <div className="min-w-0 flex-1"><div className="label">{label}</div><div className="text-sm truncate" data-account-value={kind}>{value}</div>{hint && <div className="text-xs text-text-2">{hint}</div>}</div>
      <button type="button" onClick={() => setOpen(kind)} className="btn-ghost bg-bg-3 hover:bg-bg-4 py-1.5" data-account-edit={kind}>{kind === 'password' ? 'Change Password' : 'Edit'}</button>
    </div>
  )
  return (
    <>
      <div className="rounded-xl bg-bg-0/50 p-4 space-y-4">
        <Row label="Username" value={user.username} kind="username" />
        <Row label="Email" value={streamer ? <span data-streamer-masked title="Hidden by Streamer Mode">{user.email.replace(/^(.).*(@).*$/, '$1••••••$2••••••')}</span> : user.email} kind="email" hint={pending ? `Waiting for you to confirm ${pending}` : user.email_verified_at ? undefined : 'Not verified yet'} />
        <Row label="Password" value="••••••••••" kind="password" />
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 safe-pad" onClick={() => !busy && setOpen(null)} data-account-dialog={open}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold">{open === 'username' ? 'Change your username' : open === 'email' ? 'Change your email' : 'Change your password'}</h3>
            <p className="text-sm text-text-2">
              {open === 'username' ? 'Letters, numbers, _ and . only; 2–32 characters. You can change it once a day.'
                : open === 'email' ? 'We will send a confirmation link to the new address. Nothing changes until you open it.'
                : 'Choose a new password of at least 8 characters.'}
            </p>
            {open === 'password' ? (
              <>
                <div><label className="label">Current password</label><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required autoComplete="current-password" data-account-password /></div>
                <div><label className="label">New password</label><input type="password" className="input" value={value} onChange={(e) => setValue(e.target.value)} required minLength={8} autoComplete="new-password" data-account-new /></div>
                <div><label className="label">Confirm new password</label><input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" data-account-confirm /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={logoutOthers} onChange={(e) => setLogoutOthers(e.target.checked)} data-account-logout-others /> Log out of all other devices</label>
              </>
            ) : (
              <>
                <div><label className="label">{open === 'username' ? 'New username' : 'New email'}</label><input type={open === 'email' ? 'email' : 'text'} className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus required maxLength={open === 'email' ? 254 : 32} data-account-new /></div>
                <div><label className="label">Current password</label><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-account-password /></div>
              </>
            )}
            {err && <p className="text-sm text-danger" data-account-error>{err}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(null)} disabled={busy}>Cancel</button><button className="btn-primary" disabled={busy} data-account-submit>Done</button></div>
          </form>
        </div>
      )}
    </>
  )
}

interface Standing { level: 'all_good' | 'limited' | 'very_limited' | 'at_risk' | 'suspended'; actioned_reports: number; bans: number; active_timeouts: number }
const LEVELS: Record<Standing['level'], { title: string; blurb: string; color: string }> = {
  all_good: { title: 'All good', blurb: 'Your account has no recent moderation action against it.', color: 'text-success' },
  limited: { title: 'Limited', blurb: 'There has been some moderation action against your account recently. Keep to the server rules and this clears in 90 days.', color: 'text-warn' },
  very_limited: { title: 'Very limited', blurb: 'Repeated moderation action against your account. More could lead to a suspension.', color: 'text-warn' },
  at_risk: { title: 'At risk', blurb: 'Your account is close to being suspended because of repeated moderation action.', color: 'text-danger' },
  suspended: { title: 'Suspended', blurb: 'Your account has been suspended by an administrator.', color: 'text-danger' },
}

/** Account standing card: a read of recent moderation action (resolved reports, bans, timeouts). */
export function StandingCard() {
  const [st, setSt] = useState<Standing | null>(null)
  useEffect(() => { api.get<Standing>('/users/@me/standing').then(setSt).catch(() => {}) }, [])
  if (!st) return null
  const l = LEVELS[st.level]
  const steps: Standing['level'][] = ['all_good', 'limited', 'very_limited', 'at_risk', 'suspended']
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-2" data-account-standing={st.level}>
      <div className="flex items-center gap-2">{st.level === 'all_good' ? <ShieldCheck size={18} className="text-success" /> : <ShieldAlert size={18} className={l.color} />}<h3 className="font-bold">Account Standing</h3><span className={`ml-auto text-sm font-semibold ${l.color}`}>{l.title}</span></div>
      <div className="flex gap-1">{steps.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= steps.indexOf(st.level) ? (st.level === 'all_good' ? 'bg-success' : i >= 3 ? 'bg-danger' : 'bg-warn') : 'bg-bg-4'}`} />)}</div>
      <p className="text-sm text-text-2">{l.blurb}</p>
      {st.level !== 'all_good' && <p className="text-xs text-text-2">{st.actioned_reports} actioned report{st.actioned_reports === 1 ? '' : 's'} in the last 90 days · {st.bans} server ban{st.bans === 1 ? '' : 's'} · {st.active_timeouts} active timeout{st.active_timeouts === 1 ? '' : 's'}</p>}
    </section>
  )
}
