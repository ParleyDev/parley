import { useState, type FormEvent } from 'react'
import { PowerOff, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'

/** Danger zone at the bottom of My Account: delete the account after confirming the password (and 2FA code). */
export default function DeleteAccountSection() {
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState<false | 'delete' | 'disable'>(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      if (open === 'disable') {
        await api.post('/users/@me/disable', { password, code: user.mfa_enabled ? code : undefined })
        pushToast('Your account is disabled. Log in again whenever you want it back.')
      } else {
        await api.delete('/users/@me', { password, code: user.mfa_enabled ? code : undefined })
        pushToast('Your account has been deleted.')
      }
      logout()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-danger/40 bg-danger/5 p-4 space-y-3" data-delete-account>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-danger/20 text-danger flex items-center justify-center">{open === 'disable' ? <PowerOff size={18} /> : <Trash2 size={18} />}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{open === 'disable' ? 'Disable Account' : 'Account Removal'}</h3>
          <p className="text-sm text-text-2">{open === 'disable'
            ? 'Disabling logs you out everywhere and hides your account until you log in again. Nothing is deleted.'
            : 'Disabling your account means you can recover it any time by logging in. Deleting permanently removes your account, the servers you own, your messages and uploads, and cannot be undone.'}</p>
        </div>
      </div>
      {!open ? (
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-danger/60 hover:bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger" onClick={() => setOpen('disable')} data-disable-open>Disable Account</button>
          <button type="button" className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white" onClick={() => setOpen('delete')} data-delete-open>Delete Account</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" data-delete-form>
          {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-delete-error>{err}</div>}
          <div><label className="label">Password</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-delete-password /></div>
          {user.mfa_enabled && <div><label className="label">Two-factor code</label><input className="input max-w-[200px] tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-delete-code /></div>}
          {open === 'delete' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-danger" checked={sure} onChange={(e) => setSure(e.target.checked)} data-delete-confirm /> I understand this permanently deletes my account and everything I own.</label>}
          <div className="flex gap-2">
            <button className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy || (open === 'delete' && !sure) || !password || (user.mfa_enabled && !code)} data-delete-submit>{busy ? (open === 'disable' ? 'Disabling…' : 'Deleting…') : open === 'disable' ? 'Disable my account' : 'Delete my account'}</button>
            <button type="button" className="btn-ghost py-1.5" onClick={() => { setOpen(false); setErr(null); setPassword(''); setCode(''); setSure(false) }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}
