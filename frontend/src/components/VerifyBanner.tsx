import { useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT, tn } from '../lib/i18n'

/** Top-of-app notice for accounts whose email is not verified yet, with a resend button. */
export default function VerifyBanner() {
  const t = useT()
  const user = useStore((s) => s.user)
  const mailEnabled = useStore((s) => s.instance.mail_enabled)
  const required = useStore((s) => s.instance.require_email_verification)
  const pushToast = useStore((s) => s.pushToast)
  const [sent, setSent] = useState(false)
  if (!user || user.email_verified_at || !mailEnabled) return null
  const resend = async () => { try { await api.post('/auth/resend-verification', {}); setSent(true); pushToast(t('Verification email sent to {email}', { email: user.email })) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="shrink-0 bg-warn/15 border-b border-warn/40 text-xs px-3 py-1.5 flex items-center justify-center gap-3 text-text-0" data-verify-banner>
      <span>{required ? t('Please verify your email address to create servers and use Discover.') : t('Please verify your email address.')}<span className="phone:hidden"> {tn('We sent a link to {email}.', { email: <b>{user.email}</b> })}</span></span>
      <button type="button" onClick={resend} disabled={sent} className="font-semibold underline disabled:no-underline disabled:opacity-60" data-resend-verification>{sent ? t('Sent') : t('Resend')}</button>
    </div>
  )
}
