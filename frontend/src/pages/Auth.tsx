import { LogoNeon } from '../components/Logo'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { getPasskey, passkeyError, passkeysSupported, signInWithPasskey } from '../lib/passkey'
import QrLogin from '../components/QrLogin'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { PrivateUser } from '../lib/types'
import { locale, useT } from '../lib/i18n'

/** What a sign-in answers: a session, or (for an account waiting to be deleted) its date and a restore ticket. */
type Pending = { pending_deletion: true; scheduled_for: string; restore_ticket: string }
type SignIn = { token: string; user: PrivateUser; reenabled?: boolean } | Pending
import { savedAccounts } from '../lib/accounts'
import AccountSwitcher from '../components/AccountSwitcher'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const t = useT()
  const setAuth = useStore((s) => s.setAuth)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/channels/@me'
  const [form, setForm] = useState({ login: '', email: '', username: '', display_name: '', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set when the password was right but the account has 2FA: the ticket proves step one to /auth/mfa.
  const [mfaTicket, setMfaTicket] = useState<string | null>(null)
  const [mfaKeys, setMfaKeys] = useState(false)
  const [code, setCode] = useState('')
  const registrationOpen = useStore((s) => s.instance.registration_enabled)
  const mailEnabled = useStore((s) => s.instance.mail_enabled !== false)
  const setInstance = useStore((s) => s.setInstance)
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string }>('/instance').then(setInstance).catch(() => {}) }, [setInstance])
  const closed = mode === 'register' && !registrationOpen
  // Passkeys: a button, plus the browser's autofill offering saved passkeys in the username field (conditional UI).
  useStore((s) => s.instance.app_url) // re-check support once /instance has said where this server lives
  const canPasskey = mode === 'login' && passkeysSupported()
  const autofill = useRef<AbortController | null>(null)
  // An account waiting to be deleted: the password was right, but signing in offers to restore it instead.
  const [pending, setPending] = useState<Pending | null>(null)
  const signedIn = (res: SignIn) => {
    if ('pending_deletion' in res) { setMfaTicket(null); setPending(res); return }
    setAuth(res.token, res.user)
    if (res.reenabled) useStore.getState().pushToast(t('Welcome back! Your account has been re-enabled.'))
    navigate(from, { replace: true })
  }
  useEffect(() => {
    if (!canPasskey) return
    const ctl = new AbortController(); autofill.current = ctl
    ;(async () => {
      if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return
      // Opportunistic: if this browser or device can't offer passkeys here, stay quiet; the button still explains.
      try { signedIn(await signInWithPasskey(undefined, { signal: ctl.signal })) } catch { /* no passkey offered */ }
    })()
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPasskey])
  const passkey = async () => {
    autofill.current?.abort()
    setErr(null); setBusy(true)
    try { signedIn(await signInWithPasskey(form.login)) } catch (e) { const m = passkeyError(e); if (m) setErr(m) } finally { setBusy(false) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const res = mode === 'login'
        ? await api.post<SignIn | { mfa: true; ticket: string; security_keys?: boolean }>('/auth/login', { login: form.login, password: form.password })
        : await api.post<{ token: string; user: PrivateUser }>('/auth/register', {
            email: form.email, username: form.username, display_name: form.display_name || undefined, password: form.password,
          })
      if ('mfa' in res) { setMfaTicket(res.ticket); setMfaKeys(!!res.security_keys); setCode(''); return }
      signedIn(res)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // A security key (any passkey on the account) instead of the code.
  const useKey = async () => {
    setErr(null); setBusy(true)
    try {
      const begin = await api.post<{ id: string; options: Parameters<typeof getPasskey>[0] }>('/auth/mfa/key/begin', { ticket: mfaTicket })
      const credential = await getPasskey(begin.options)
      signedIn(await api.post<SignIn>('/auth/mfa/key/finish', { ticket: mfaTicket, id: begin.id, credential }))
    } catch (e) { const m = passkeyError(e); if (m) setErr(m) } finally { setBusy(false) }
  }
  const qrSession = useCallback((token: string, user: PrivateUser) => { setAuth(token, user); navigate(from, { replace: true }) }, [setAuth, navigate, from])
  const submitMfa = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      signedIn(await api.post<SignIn>('/auth/mfa', { ticket: mfaTicket, code }))
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg)
      if (/expired/i.test(msg)) setMfaTicket(null)
    } finally {
      setBusy(false)
    }
  }

  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }) })

  const restore = async () => {
    if (!pending) return
    setErr(null); setBusy(true)
    try { const res = await api.post<SignIn>('/auth/restore', { ticket: pending.restore_ticket }); setPending(null); signedIn(res); useStore.getState().pushToast(t('Welcome back! Your account has been restored.')) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (pending) {
    const date = new Date(pending.scheduled_for).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' })
    return (
      <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 relative bg-bg-0">
        <div className="pop relative w-full max-w-md rounded-2xl bg-bg-1/90 backdrop-blur border border-line p-8 shadow-2xl space-y-4" data-restore-account={pending.scheduled_for}>
          <div className="flex items-center gap-3">
            <LogoNeon className="h-10 w-10 rounded-xl shadow-lg shadow-accent/30" />
            <h1 className="text-xl font-bold leading-tight">{t('Restore your account?')}</h1>
          </div>
          <p className="text-[15px] text-text-1">{t('Your account is scheduled for deletion on {date}. Restore it to keep everything as it was.', { date })}</p>
          {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm">{err}</div>}
          <button className="btn-primary w-full py-2.5" disabled={busy} onClick={restore} data-restore-yes>{busy ? t('Please wait…') : t('Restore my account')}</button>
          <button type="button" className="btn-ghost w-full py-2.5" onClick={() => { setPending(null); setErr(null) }} data-restore-no>{t('Keep it deleted')}</button>
        </div>
      </div>
    )
  }

  if (mfaTicket) {
    return (
      <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 relative bg-bg-0">
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden><div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent/25 blur-[120px]" /><div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px]" /></div>
        <form onSubmit={submitMfa} className="pop relative w-full max-w-md rounded-2xl bg-bg-1/90 backdrop-blur border border-line p-8 shadow-2xl" data-mfa-form>
          <div className="flex items-center gap-3 mb-6">
            <LogoNeon className="h-10 w-10 rounded-xl shadow-lg shadow-accent/30" />
            <div>
              <h1 className="text-xl font-bold leading-tight">{t('Two-factor authentication')}</h1>
              <p className="text-sm text-text-2">{t('Enter the 6-digit code from your authenticator app, or one of your backup codes.')}</p>
            </div>
          </div>
          {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-mfa-error>{err}</div>}
          <div>
            <label className="label">{t('Authentication code')}</label>
            <input className="input tracking-widest" autoFocus autoComplete="one-time-code" inputMode="text" required value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('123456 or abcde-fghij')} data-mfa-code />
          </div>
          <button className="btn-primary w-full mt-6 py-2.5" disabled={busy || !code.trim()}>{busy ? t('Please wait…') : t('Log In')}</button>
          {mfaKeys && passkeysSupported() && <button type="button" className="btn-ghost mt-2 w-full py-2.5" disabled={busy} onClick={useKey} data-mfa-key><KeyRound size={16} /> {t('Use a security key instead')}</button>}
          <p className="mt-4 text-sm text-text-2"><button type="button" className="text-sky-400 hover:underline" onClick={() => { setMfaTicket(null); setErr(null) }} data-mfa-back>{t('Back to login')}</button></p>
        </form>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 relative bg-bg-0">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden><div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent/25 blur-[120px]" /><div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px]" /></div>
      <div className="relative flex w-full max-w-3xl items-stretch justify-center gap-4">
      <form onSubmit={submit} className="pop relative w-full max-w-md flex-1 rounded-2xl bg-bg-1/90 backdrop-blur border border-line p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <LogoNeon className="h-10 w-10 rounded-xl shadow-lg shadow-accent/30" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{mode === 'login' ? t('Welcome back!') : t('Create an account')}</h1>
            <p className="text-sm text-text-2">{mode === 'login' ? t("We're so excited to see you again!") : t('Join the conversation.')}</p>
          </div>
        </div>

        {mode === 'login' && savedAccounts().length > 0 && (
          <div className="mb-5" data-saved-accounts>
            <div className="label">{t('Continue as')}</div>
            <div className="rounded-lg border border-line p-1"><AccountSwitcher signedIn={false} /></div>
            <div className="mt-4 flex items-center gap-3 text-xs uppercase tracking-wider text-text-2"><span className="h-px flex-1 bg-line" />{t('or sign in')}<span className="h-px flex-1 bg-line" /></div>
          </div>
        )}
        {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-auth-error>{err}</div>}
        {closed && <div className="mb-4 rounded-lg bg-warn/15 border border-warn/40 px-3 py-2 text-sm" data-registration-closed>{t('Registration is closed on this Parley instance right now. If you already have an account, log in instead.')}</div>}

        <div className="space-y-4">
          {mode === 'login' ? (
            <div><label className="label">{t('Email or username')}</label><input className="input" autoFocus autoComplete={canPasskey ? 'username webauthn' : 'username'} required {...f('login')} data-login-input /></div>
          ) : (
            <>
              <div><label className="label">{t('Email')}</label><input className="input" type="email" autoFocus autoComplete="email" required {...f('email')} /></div>
              <div><label className="label">{t('Username')}</label><input className="input" autoComplete="username" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_.]+" title={t('Letters, numbers, _ or .')} {...f('username')} /></div>
              <div><label className="label">{t('Display name')} <span className="normal-case font-normal text-text-2">{t('(optional)')}</span></label><input className="input" maxLength={32} {...f('display_name')} /></div>
            </>
          )}
          <div>
            <label className="label">{t('Password')}</label>
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} {...f('password')} />
            {mode === 'login' && mailEnabled && <Link to="/forgot" className="mt-1.5 inline-block text-xs text-sky-400 hover:underline" data-forgot-link>{t('Forgot your password?')}</Link>}
          </div>
        </div>

        <button className="btn-primary w-full mt-6 py-2.5" disabled={busy || closed}>{busy ? t('Please wait…') : mode === 'login' ? t('Log In') : t('Continue')}</button>
        {canPasskey && (
          <>
            <div className="my-3 flex items-center gap-3 text-xs uppercase tracking-wider text-text-2"><span className="h-px flex-1 bg-line" />{t('or')}<span className="h-px flex-1 bg-line" /></div>
            <button type="button" onClick={passkey} disabled={busy} className="btn-ghost w-full py-2.5 border border-line" data-passkey-login><KeyRound size={16} /> {t('Sign in with a passkey')}</button>
          </>
        )}

        <p className="mt-4 text-sm text-text-2">
          {mode === 'login' ? (
            registrationOpen ? <>{t('Need an account?')} <Link to="/register" className="text-sky-400 hover:underline">{t('Register')}</Link></> : <span data-registration-closed-note>{t('Registration is currently closed.')}</span>
          ) : (
            <><Link to="/login" className="text-sky-400 hover:underline">{t('Already have an account?')}</Link></>
          )}
        </p>
      </form>
      {mode === 'login' && <div className="pop hidden w-64 shrink-0 items-center justify-center rounded-2xl border border-line bg-bg-1/90 p-6 shadow-2xl backdrop-blur md:flex"><QrLogin onSession={qrSession} /></div>}
      </div>
    </div>
  )
}
