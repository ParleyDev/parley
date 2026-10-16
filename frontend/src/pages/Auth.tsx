import { APP_INITIAL } from '../lib/brand'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { PrivateUser } from '../lib/types'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const setAuth = useStore((s) => s.setAuth)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/channels/@me'
  const [form, setForm] = useState({ login: '', email: '', username: '', display_name: '', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set when the password was right but the account has 2FA: the ticket proves step one to /auth/mfa.
  const [mfaTicket, setMfaTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const registrationOpen = useStore((s) => s.instance.registration_enabled)
  const mailEnabled = useStore((s) => s.instance.mail_enabled !== false)
  const setInstance = useStore((s) => s.setInstance)
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string }>('/instance').then(setInstance).catch(() => {}) }, [setInstance])
  const closed = mode === 'register' && !registrationOpen

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const res = mode === 'login'
        ? await api.post<{ token: string; user: PrivateUser } | { mfa: true; ticket: string }>('/auth/login', { login: form.login, password: form.password })
        : await api.post<{ token: string; user: PrivateUser }>('/auth/register', {
            email: form.email, username: form.username, display_name: form.display_name || undefined, password: form.password,
          })
      if ('mfa' in res) { setMfaTicket(res.ticket); setCode(''); return }
      setAuth(res.token, res.user)
      navigate(from, { replace: true })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const res = await api.post<{ token: string; user: PrivateUser }>('/auth/mfa', { ticket: mfaTicket, code })
      setAuth(res.token, res.user)
      navigate(from, { replace: true })
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg)
      if (/expired/i.test(msg)) setMfaTicket(null)
    } finally {
      setBusy(false)
    }
  }

  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }) })

  if (mfaTicket) {
    return (
      <div className="h-full flex items-center justify-center p-4 relative overflow-hidden bg-bg-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent/25 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px]" />
        <form onSubmit={submitMfa} className="pop relative w-full max-w-md rounded-2xl bg-bg-1/90 backdrop-blur border border-line p-8 shadow-2xl" data-mfa-form>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center text-white font-extrabold text-xl shadow-lg shadow-accent/30">{APP_INITIAL}</div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Two-factor authentication</h1>
              <p className="text-sm text-text-2">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
            </div>
          </div>
          {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-mfa-error>{err}</div>}
          <div>
            <label className="label">Authentication code</label>
            <input className="input tracking-widest" autoFocus autoComplete="one-time-code" inputMode="text" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or abcde-fghij" data-mfa-code />
          </div>
          <button className="btn-primary w-full mt-6 py-2.5" disabled={busy || !code.trim()}>{busy ? 'Please wait…' : 'Log In'}</button>
          <p className="mt-4 text-sm text-text-2"><button type="button" className="text-sky-400 hover:underline" onClick={() => { setMfaTicket(null); setErr(null) }} data-mfa-back>Back to login</button></p>
        </form>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center p-4 relative overflow-hidden bg-bg-0">
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent/25 blur-[120px]" />
      <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px]" />
      <form onSubmit={submit} className="pop relative w-full max-w-md rounded-2xl bg-bg-1/90 backdrop-blur border border-line p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center text-white font-extrabold text-xl shadow-lg shadow-accent/30">{APP_INITIAL}</div>
          <div>
            <h1 className="text-xl font-bold leading-tight">{mode === 'login' ? 'Welcome back!' : 'Create an account'}</h1>
            <p className="text-sm text-text-2">{mode === 'login' ? "We're so excited to see you again!" : 'Join the conversation.'}</p>
          </div>
        </div>

        {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm">{err}</div>}
        {closed && <div className="mb-4 rounded-lg bg-warn/15 border border-warn/40 px-3 py-2 text-sm" data-registration-closed>Registration is closed on this Parley instance right now. If you already have an account, log in instead.</div>}

        <div className="space-y-4">
          {mode === 'login' ? (
            <div><label className="label">Email or username</label><input className="input" autoFocus autoComplete="username" required {...f('login')} /></div>
          ) : (
            <>
              <div><label className="label">Email</label><input className="input" type="email" autoFocus autoComplete="email" required {...f('email')} /></div>
              <div><label className="label">Username</label><input className="input" autoComplete="username" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_.]+" title="Letters, numbers, _ or ." {...f('username')} /></div>
              <div><label className="label">Display name <span className="normal-case font-normal text-text-2">(optional)</span></label><input className="input" maxLength={32} {...f('display_name')} /></div>
            </>
          )}
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} {...f('password')} />
            {mode === 'login' && mailEnabled && <Link to="/forgot" className="mt-1.5 inline-block text-xs text-sky-400 hover:underline" data-forgot-link>Forgot your password?</Link>}
          </div>
        </div>

        <button className="btn-primary w-full mt-6 py-2.5" disabled={busy || closed}>{busy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Continue'}</button>

        <p className="mt-4 text-sm text-text-2">
          {mode === 'login' ? (
            registrationOpen ? <>Need an account? <Link to="/register" className="text-sky-400 hover:underline">Register</Link></> : <span data-registration-closed-note>Registration is currently closed.</span>
          ) : (
            <><Link to="/login" className="text-sky-400 hover:underline">Already have an account?</Link></>
          )}
        </p>
      </form>
    </div>
  )
}
