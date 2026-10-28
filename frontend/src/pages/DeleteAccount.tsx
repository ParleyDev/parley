import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LogoNeon } from '../components/Logo'
import DeleteAccountFlow, { DeletionScheduled } from '../components/DeleteAccountFlow'
import { api } from '../lib/api'
import { locale, useT } from '../lib/i18n'
import type { PrivateUser } from '../lib/types'
import { useStore } from '../store'

type SignIn = { token: string; user: PrivateUser } | { mfa: true; ticket: string } | { pending_deletion: true; scheduled_for: string; restore_ticket: string }

/**
 * `/delete-account`: delete your Parley account from any browser, without the app (app stores ask for a web link).
 * Says what deletion does, signs you in (password, and a 2FA code when on), then runs the same flow as Settings.
 */
export default function DeleteAccountPage() {
  const t = useT()
  const token = useStore((s) => s.token)
  const user = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const logout = useStore((s) => s.logout)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [already, setAlready] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Signed in already (a stored session) but the account isn't loaded on this page yet.
  useEffect(() => { if (token && !user) api.get<PrivateUser>('/users/@me').then((u) => setAuth(token, u)).catch(() => logout()) }, [token, user, setAuth, logout])

  const answer = (r: SignIn) => {
    if ('mfa' in r) { setTicket(r.ticket); return }
    if ('pending_deletion' in r) { setAlready(r.scheduled_for); return }
    setAuth(r.token, r.user)
  }
  const signIn = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { answer(ticket ? await api.post<SignIn>('/auth/mfa', { ticket, code }) : await api.post<SignIn>('/auth/login', { login, password })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 bg-bg-0" data-delete-account-page>
      <div className="w-full max-w-lg rounded-2xl bg-bg-1 border border-line p-8 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <LogoNeon className="h-10 w-10 rounded-xl" />
          <div><h1 className="text-xl font-bold leading-tight">{t('Delete your Parley account')}</h1><p className="text-sm text-text-2">{t('You can do this here or in the app: Settings › Account › Account Removal.')}</p></div>
        </div>
        {done ? (
          <>
            <DeletionScheduled at={done} />
            <Link to="/login" className="btn-ghost w-full justify-center">{t('Back to sign in')}</Link>
          </>
        ) : already ? (
          <div className="space-y-3" data-delete-already={already}>
            <p className="text-sm">{t('This account is already scheduled for deletion on {date}.', { date: fmt(already) })}</p>
            <p className="text-sm text-text-2">{t('Changed your mind? Sign in to Parley before then and choose Restore.')}</p>
            <Link to="/login" className="btn-primary w-full justify-center">{t('Sign in to restore')}</Link>
          </div>
        ) : token && user ? (
          <>
            <p className="text-sm text-text-1">{t('Signed in as {name}.', { name: user.username })}</p>
            <DeleteAccountFlow onDone={(at) => { setDone(at); logout() }} />
          </>
        ) : (
          <form onSubmit={signIn} className="space-y-3" data-delete-signin>
            <p className="text-sm text-text-1">{t('Sign in to the account you want to delete. Nothing happens until you confirm.')}</p>
            {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-delete-signin-error>{err}</div>}
            {!ticket ? (
              <>
                <div><label className="label">{t('Email or username')}</label><input className="input" autoFocus autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} data-delete-login /></div>
                <div><label className="label">{t('Password')}</label><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-delete-login-password /></div>
              </>
            ) : (
              <div><label className="label">{t('Two-factor code')}</label><input className="input tracking-widest" autoFocus autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-delete-login-code /></div>
            )}
            <button className="btn-primary w-full py-2.5" disabled={busy} data-delete-login-submit>{busy ? t('Please wait…') : t('Sign in')}</button>
          </form>
        )}
      </div>
    </div>
  )
}
