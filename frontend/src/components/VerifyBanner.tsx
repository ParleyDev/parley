import { useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

/** Top-of-app notice for accounts whose email is not verified yet, with a resend button. */
export default function VerifyBanner() {
  const user = useStore((s) => s.user)
  const mailEnabled = useStore((s) => s.instance.mail_enabled)
  const required = useStore((s) => s.instance.require_email_verification)
  const pushToast = useStore((s) => s.pushToast)
  const [sent, setSent] = useState(false)
  if (!user || user.email_verified_at || !mailEnabled) return null
  const resend = async () => { try { await api.post('/auth/resend-verification', {}); setSent(true); pushToast(`Verification email sent to ${user.email}`) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="shrink-0 bg-warn/15 border-b border-warn/40 text-xs px-3 py-1.5 flex items-center justify-center gap-3 text-text-0" data-verify-banner>
      <span>Please verify your email address{required ? ' to create servers and use Discover' : ''}. We sent a link to <b>{user.email}</b>.</span>
      <button type="button" onClick={resend} disabled={sent} className="font-semibold underline disabled:no-underline disabled:opacity-60" data-resend-verification>{sent ? 'Sent' : 'Resend'}</button>
    </div>
  )
}
