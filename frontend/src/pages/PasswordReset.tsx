import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LogoNeon } from '../components/Logo'
import { api } from '../lib/api'

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 bg-bg-0">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1/90 border border-line p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <LogoNeon className="h-10 w-10 rounded-xl" />
          <div><h1 className="text-xl font-bold leading-tight">{title}</h1>{subtitle && <p className="text-sm text-text-2">{subtitle}</p>}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** /forgot — ask for a reset link. Always says "sent" so addresses cannot be probed. */
export function ForgotPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await api.post('/auth/forgot', { email }); setDone(true) } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
      {done ? (
        <div data-forgot-sent>
          <p className="text-sm text-text-1">If an account exists for <b>{email}</b>, a reset link is on its way. It is valid for one hour.</p>
          <Link to="/login" className="btn-primary inline-flex mt-6">Back to log in</Link>
        </div>
      ) : (
        <form onSubmit={submit} data-forgot-form>
          {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm">{err}</div>}
          <label className="label">Email</label>
          <input className="input" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} data-forgot-email />
          <button className="btn-primary w-full mt-6 py-2.5" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
          <p className="mt-4 text-sm text-text-2"><Link to="/login" className="text-sky-400 hover:underline">Back to log in</Link></p>
        </form>
      )}
    </Card>
  )
}

/** /reset?token=… — choose a new password. */
export function ResetPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(token ? null : 'This link is missing its token.')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null)
    if (pw !== pw2) { setErr('Passwords do not match.'); return }
    setBusy(true)
    try { await api.post('/auth/reset', { token, password: pw }); setDone(true) } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card title="Choose a new password">
      {done ? (
        <div data-reset-done>
          <p className="text-sm text-text-1">Your password has been changed. Log in with the new one.</p>
          <Link to="/login" className="btn-primary inline-flex mt-6">Log in</Link>
        </div>
      ) : (
        <form onSubmit={submit} data-reset-form>
          {err && <div className="mb-4 rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-reset-error>{err}</div>}
          <label className="label">New password</label>
          <input className="input" type="password" autoFocus required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-reset-password />
          <label className="label mt-4">Confirm password</label>
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-reset-confirm />
          <button className="btn-primary w-full mt-6 py-2.5" disabled={busy || !token}>{busy ? 'Please wait…' : 'Change password'}</button>
          <p className="mt-4 text-sm text-text-2"><Link to="/forgot" className="text-sky-400 hover:underline">Request a new link</Link></p>
        </form>
      )}
    </Card>
  )
}
