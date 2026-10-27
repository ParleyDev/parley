import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LogoNeon } from '../components/Logo'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** /verify?token=… — the link from the verification email; /confirm-email?token=… — the link sent to a new address
 *  when changing email. Both work whether or not you are logged in. */
export default function VerifyPage({ mode = 'verify' }: { mode?: 'verify' | 'change' }) {
  const t = useT()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working')
  const [msg, setMsg] = useState('')
  const me = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const jwt = useStore((s) => s.token)
  useEffect(() => {
    if (!token) { setState('bad'); setMsg(t('This link is missing its token.')); return }
    api.post<{ ok: boolean }>(mode === 'change' ? '/auth/confirm-email' : '/auth/verify', { token }).then(async () => {
      // Refresh the stored user before offering "Open Parley", so the app never shows a stale banner.
      if (jwt) { try { setAuth(jwt, await api.get('/users/@me')) } catch { /* refresh later */ } }
      setState('ok')
    }).catch((e: Error) => { setState('bad'); setMsg(e.message) })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 bg-bg-0">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1/90 border border-line p-8 shadow-2xl text-center" data-verify-page data-verify-state={state}>
        <LogoNeon className="mx-auto h-12 w-12 rounded-xl" />
        {state === 'working' && <p className="mt-6 text-text-1">{mode === 'change' ? t('Confirming your new email…') : t('Verifying your email…')}</p>}
        {state === 'ok' && <><h1 className="mt-6 text-xl font-bold">{mode === 'change' ? t('Email changed') : t('Email verified')}</h1><p className="mt-2 text-sm text-text-2">{me ? t("Thanks, {name}. You're all set.", { name: me.display_name }) : t("Thanks. You're all set.")}</p></>}
        {state === 'bad' && <><h1 className="mt-6 text-xl font-bold">{t("That link didn't work")}</h1><p className="mt-2 text-sm text-text-2">{msg}</p></>}
        <Link to={jwt ? '/channels/@me' : '/login'} className="btn-primary inline-flex mt-6">{jwt ? t('Open Parley') : t('Log in')}</Link>
      </div>
    </div>
  )
}
