import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import { useT } from '../../../lib/i18n'

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regen'

/** Two-factor authentication card in My Account: enrol with a QR code, show backup codes, regenerate, disable. */
export default function MfaSection() {
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const [step, setStep] = useState<Step>('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [secret, setSecret] = useState('')
  const [qr, setQr] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const enabled = !!user?.mfa_enabled

  useEffect(() => { setErr(null); setCode('') }, [step])

  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setSecret(''); setQr(''); setErr(null) }
  const apply = (u: PrivateUser) => { if (token) setAuth(token, u) }

  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const enroll = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ secret: string; otpauth_url: string }>('/users/@me/mfa/enroll', { password })
    setSecret(r.secret)
    setQr(await QRCode.toDataURL(r.otpauth_url, { margin: 1, width: 180 }))
    setStep('scan')
  }) }

  const confirm = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ backup_codes: string[]; user: PrivateUser }>('/users/@me/mfa/confirm', { code })
    apply(r.user); setCodes(r.backup_codes); setStep('codes'); pushToast(t('Two-factor authentication enabled'))
  }) }

  const regen = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ backup_codes: string[] }>('/users/@me/mfa/backup-codes', { password })
    setCodes(r.backup_codes); setStep('codes'); pushToast(t('New backup codes generated'))
  }) }

  const disable = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const u = await api.post<PrivateUser>('/users/@me/mfa/disable', { password, code })
    apply(u); reset(); pushToast(t('Two-factor authentication disabled'))
  }) }

  const copyCodes = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); pushToast(t('Backup codes copied')) } catch { pushToast(t('Could not copy'), 'error') } }

  if (!user) return null
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-mfa-section data-mfa-enabled={enabled ? '1' : '0'}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${enabled ? 'bg-success/20 text-success' : 'bg-bg-3 text-text-2'}`}>{enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t('Two-Factor Authentication')}</h3>
          <p className="text-sm text-text-2">{enabled ? t('Enabled. Logging in needs a code from your authenticator app or a backup code.') : t('Protect your account with a second step at login: a 6-digit code from an authenticator app such as Aegis, Google Authenticator or 1Password.')}</p>
        </div>
      </div>
      {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-mfa-error>{err}</div>}

      {step === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {!enabled && <button type="button" className="btn-primary py-1.5" onClick={() => setStep('password')} data-mfa-enable>{t('Enable Two-Factor Auth')}</button>}
          {enabled && <button type="button" className="btn-ghost py-1.5" onClick={() => setStep('regen')} data-mfa-regen>{t('View Backup Codes')}</button>}
          {enabled && <button type="button" className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white" onClick={() => setStep('disable')} data-mfa-disable>{t('Remove 2FA')}</button>}
        </div>
      )}

      {(step === 'password' || step === 'regen') && (
        <form onSubmit={step === 'password' ? enroll : regen} className="space-y-3" data-mfa-password-form>
          <div><label className="label">{t('Confirm your password')}</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-mfa-password /></div>
          <div className="flex gap-2"><button className="btn-primary py-1.5" disabled={busy || !password} data-mfa-password-submit>{t('Continue')}</button><button type="button" className="btn-ghost py-1.5" onClick={reset}>{t('Cancel')}</button></div>
        </form>
      )}

      {step === 'scan' && (
        <form onSubmit={confirm} className="space-y-3" data-mfa-scan>
          <div className="flex flex-col sm:flex-row gap-4">
            {qr && <img src={qr} alt={t('QR code for your authenticator app')} className="h-[180px] w-[180px] rounded-lg bg-white p-1 self-start" data-mfa-qr />}
            <div className="text-sm space-y-2 min-w-0">
              <p className="text-text-1">{t('Scan the QR code with your authenticator app, or enter this key by hand:')}</p>
              <code className="block break-all rounded bg-bg-0 px-2 py-1 font-mono text-xs select-all" data-mfa-secret>{secret}</code>
              <p className="text-text-2">{t('Then type the 6-digit code the app shows to finish.')}</p>
            </div>
          </div>
          <div><label className="label">{t('Code from the app')}</label><input className="input max-w-[200px] tracking-widest" autoFocus autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} data-mfa-confirm-code /></div>
          <div className="flex gap-2"><button className="btn-primary py-1.5" disabled={busy || code.replace(/\D/g, '').length !== 6} data-mfa-confirm>{t('Activate')}</button><button type="button" className="btn-ghost py-1.5" onClick={reset}>{t('Cancel')}</button></div>
        </form>
      )}

      {step === 'codes' && (
        <div className="space-y-3" data-mfa-codes>
          <p className="text-sm text-text-1">{t('Keep these backup codes somewhere safe. Each one logs you in once if you lose your authenticator. They are only shown now.')}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-bg-0 p-3 font-mono text-sm" data-mfa-backup-codes>
            {codes.map((c) => <li key={c} data-mfa-backup-code>{c}</li>)}
          </ul>
          <div className="flex gap-2"><button type="button" className="btn-ghost py-1.5" onClick={copyCodes}>{t('Copy')}</button><button type="button" className="btn-primary py-1.5" onClick={reset} data-mfa-codes-done>{t('Done')}</button></div>
        </div>
      )}

      {step === 'disable' && (
        <form onSubmit={disable} className="space-y-3" data-mfa-disable-form>
          <p className="text-sm text-text-1">{t('Removing two-factor authentication makes your account less secure. Confirm with your password and a current code.')}</p>
          <div><label className="label">{t('Password')}</label><input className="input" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-mfa-password /></div>
          <div><label className="label">{t('Authentication or backup code')}</label><input className="input max-w-[200px] tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-mfa-disable-code /></div>
          <div className="flex gap-2"><button className="rounded-md bg-danger/90 hover:bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !password || !code} data-mfa-disable-submit>{t('Remove 2FA')}</button><button type="button" className="btn-ghost py-1.5" onClick={reset}>{t('Cancel')}</button></div>
        </form>
      )}
    </section>
  )
}
