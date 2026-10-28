import { useState, type FormEvent } from 'react'
import { PowerOff, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { locale, useT } from '../../../lib/i18n'
import DeleteAccountFlow from '../../DeleteAccountFlow'

/** Account Removal: disable the account (log in to undo), or delete it (scheduled, restorable for the grace period). */
export default function DeleteAccountSection() {
  const t = useT()
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState<false | 'delete' | 'disable'>(false)
  const openModal = useStore((s) => s.openModal)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      await api.post('/users/@me/disable', { password, code: user.mfa_enabled ? code : undefined })
      pushToast(t('Your account is disabled. Log in again whenever you want it back.'))
      logout()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-danger/40 bg-danger/5 p-4 space-y-3" data-delete-account>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-danger/20 text-danger flex items-center justify-center">{open === 'disable' ? <PowerOff size={18} /> : <Trash2 size={18} />}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{open === 'disable' ? t('Disable Account') : t('Account Removal')}</h3>
          <p className="text-sm text-text-2">{open === 'disable'
            ? t('Disabling logs you out everywhere and hides your account until you log in again. Nothing is deleted.')
            : t('Disabling your account means you can recover it any time by logging in. Deleting schedules your account for deletion: sign in within the grace period to restore it, after which your personal data is erased for good.')}</p>
        </div>
      </div>
      {!open ? (
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-danger/60 hover:bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger" onClick={() => setOpen('disable')} data-disable-open>{t('Disable Account')}</button>
          <button type="button" className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white" onClick={() => setOpen('delete')} data-delete-open>{t('Delete Account')}</button>
        </div>
      ) : open === 'delete' ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }} data-delete-dialog>
          <div className="pop w-full max-w-lg rounded-xl bg-bg-1 border border-line p-5 shadow-2xl space-y-3" role="dialog" aria-modal>
            <h3 className="text-lg font-bold flex items-center gap-2"><Trash2 size={18} className="text-danger" />{t('Delete Account')}</h3>
            <DeleteAccountFlow onCancel={() => setOpen(false)}
              onManage={({ guildId, apps }) => { if (guildId) openModal({ kind: 'guildSettings', guildId }); else if (apps) openModal({ kind: 'userSettings', tab: 'applications' }) }}
              onDone={(at) => { pushToast(t('Your account is scheduled for deletion on {date}. Sign in before then to restore it.', { date: new Date(at).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) })); logout() }} />
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" data-delete-form>
          {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-delete-error>{err}</div>}
          <div><label className="label">{t('Password')}</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-delete-password /></div>
          {user.mfa_enabled && <div><label className="label">{t('Two-factor code')}</label><input className="input max-w-[200px] tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-delete-code /></div>}
          <div className="flex gap-2">
            <button className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !password || (user.mfa_enabled && !code)} data-disable-submit>{busy ? t('Disabling…') : t('Disable my account')}</button>
            <button type="button" className="btn-ghost py-1.5" onClick={() => { setOpen(false); setErr(null); setPassword(''); setCode('') }}>{t('Cancel')}</button>
          </div>
        </form>
      )}
    </section>
  )
}
