import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import type { PrivateUser } from '../../lib/types'

/** Keep a guest account: pick a username, add an email and a password. Messages, profile and the demo server stay. */
export default function ClaimGuestModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) })
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setErr(null); setBusy(true)
    try {
      const user = await api.post<PrivateUser>('/auth/claim', form)
      if (token) setAuth(token, user)
      pushToast(t('Welcome to Parley! Your account is yours to keep.'))
      onClose()
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={t('Keep your account')} onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Not now')}</button><button type="submit" form="claim-guest" className="btn-primary" disabled={busy} data-claim-submit>{busy ? t('Please wait…') : t('Sign Up')}</button></>}>
      <form id="claim-guest" onSubmit={submit} className="space-y-4" data-claim-form>
        <p className="text-sm text-text-2">{t('Your messages, profile and servers come with you.')}</p>
        {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-claim-error>{err}</div>}
        <div><label className="label">{t('Email')}</label><input className="input" type="email" autoComplete="email" required autoFocus {...f('email')} data-claim-email /></div>
        <div><label className="label">{t('Username')}</label><input className="input" autoComplete="username" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_.]+" title={t('Letters, numbers, _ or .')} {...f('username')} data-claim-username /></div>
        <div><label className="label">{t('Password')}</label><input className="input" type="password" autoComplete="new-password" required minLength={8} {...f('password')} data-claim-password /></div>
      </form>
    </Modal>
  )
}
