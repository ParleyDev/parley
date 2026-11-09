import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { LogoNeon } from '../components/Logo'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { startGuest } from '../lib/guest'

/** /try — the website's "Try it now" link: straight into the demo server as a guest, no sign-up. */
export default function TryPage() {
  const t = useT()
  const token = useStore((s) => s.token)
  const navigate = useNavigate()
  const [err, setErr] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (token || started.current) return
    started.current = true
    startGuest().then((gid) => navigate(`/channels/${gid}`, { replace: true })).catch((e: Error) => setErr(e.message))
  }, [token, navigate])
  if (token && !started.current) return <Navigate to="/channels/@me" replace />
  return (
    <div className="h-full flex items-center justify-center p-4 bg-bg-0">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1 border border-line p-8 shadow-2xl text-center" data-try-page>
        <LogoNeon className="mx-auto h-12 w-12 rounded-xl" />
        {err ? (
          <>
            <h1 className="mt-4 text-xl font-bold">{t("Couldn't start a guest session")}</h1>
            <p className="mt-2 text-sm text-text-2" data-try-error>{err}</p>
            <div className="mt-6 flex justify-center gap-2"><Link to="/register" className="btn-primary">{t('Create an account')}</Link><Link to="/login" className="btn-ghost">{t('Log In')}</Link></div>
          </>
        ) : (
          <><h1 className="mt-4 text-xl font-bold">{t('Setting up your guest pass…')}</h1><p className="mt-2 text-sm text-text-2">{t('No sign-up needed. You can keep the account later if you like it.')}</p></>
        )}
      </div>
    </div>
  )
}
