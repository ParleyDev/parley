import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'

/** Danger zone at the bottom of My Account: delete the account after confirming the password (and 2FA code). */
export default function DeleteAccountSection() {
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      await api.delete('/users/@me', { password, code: user.mfa_enabled ? code : undefined })
      pushToast('Your account has been deleted.')
      logout()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-danger/40 bg-danger/5 p-4 space-y-3" data-delete-account>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-danger/20 text-danger flex items-center justify-center"><Trash2 size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Delete Account</h3>
          <p className="text-sm text-text-2">Permanently removes your account, the servers you own, your messages and uploads. This cannot be undone.</p>
        </div>
      </div>
      {!open ? (
        <button type="button" className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white" onClick={() => setOpen(true)} data-delete-open>Delete Account</button>
      ) : (
        <form onSubmit={submit} className="space-y-3" data-delete-form>
          {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-delete-error>{err}</div>}
          <div><label className="label">Password</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-delete-password /></div>
          {user.mfa_enabled && <div><label className="label">Two-factor code</label><input className="input max-w-[200px] tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-delete-code /></div>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-danger" checked={sure} onChange={(e) => setSure(e.target.checked)} data-delete-confirm /> I understand this permanently deletes my account and everything I own.</label>
          <div className="flex gap-2">
            <button className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !sure || !password || (user.mfa_enabled && !code)} data-delete-submit>{busy ? 'Deleting…' : 'Delete my account'}</button>
            <button type="button" className="btn-ghost py-1.5" onClick={() => { setOpen(false); setErr(null); setPassword(''); setCode(''); setSure(false) }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}
