import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { APP_NAME } from '../lib/brand'
import { LogoNeon } from '../components/Logo'
import { api } from '../lib/api'
import { useStore } from '../store'
import Avatar from '../components/Avatar'
import type { User } from '../lib/types'

interface Info { app: { id: string; name: string; description: string; client_id: string; has_bot: boolean; owner: User | null }; scopes: { id: string; description: string }[]; redirect_uri: string; state: string | null; guilds: { id: string; name: string; icon_url: string | null }[] }

/** /oauth2/authorize?client_id=…: the consent screen for a third-party app (and the bot's server picker). */
export default function OAuthPage() {
  const [params] = useSearchParams()
  const me = useStore((s) => s.user)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [guild, setGuild] = useState('')
  const [busy, setBusy] = useState(false)
  const q = Object.fromEntries(params.entries())
  useEffect(() => { api.get<Info>(`/oauth2/authorize?${params.toString()}`).then((i) => { setInfo(i); setGuild(i.guilds[0]?.id ?? '') }).catch((e: Error) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const approve = async () => {
    setBusy(true); setErr(null)
    try { const r = await api.post<{ redirect: string }>('/oauth2/authorize', { client_id: q.client_id, redirect_uri: q.redirect_uri, scope: q.scope, state: q.state, guild_id: guild || undefined }); window.location.href = r.redirect } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  const cancel = () => { if (info) { try { const u = new URL(info.redirect_uri); u.searchParams.set('error', 'access_denied'); if (info.state) u.searchParams.set('state', info.state); window.location.href = u.toString(); return } catch { /* fall through */ } } history.back() }
  const wantsBot = info?.scopes.some((s) => s.id === 'bot')
  return (
    <div className="h-full flex items-center justify-center p-4 bg-bg-0">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1/90 border border-line p-6 shadow-2xl" data-oauth-page>
        <div className="flex items-center justify-center gap-3">
          <LogoNeon className="h-12 w-12 rounded-xl" />
          <span className="text-text-2">⇄</span>
          <div className="h-12 w-12 rounded-xl bg-bg-3 flex items-center justify-center text-xl font-extrabold">{info?.app.name[0] ?? '?'}</div>
        </div>
        {err && !info && <p className="mt-6 text-center text-sm text-danger" data-oauth-error>{err}</p>}
        {info && (
          <>
            <h1 className="mt-5 text-center text-lg font-bold" data-oauth-app>{info.app.name}</h1>
            <p className="text-center text-sm text-text-2">wants to access your {APP_NAME} account{info.app.owner ? <> · by {info.app.owner.display_name}</> : null}</p>
            {me && <div className="mt-4 flex items-center justify-center gap-2 text-sm"><Avatar user={me} size={24} /><span>Signed in as <b>{me.display_name}</b></span></div>}
            <div className="mt-5 rounded-xl border border-line bg-bg-0/60 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">This will allow {info.app.name} to</div>
              <ul className="space-y-1.5 text-sm">{info.scopes.map((s) => <li key={s.id} className="flex items-start gap-2" data-oauth-scope={s.id}><span className="mt-0.5 text-success">✓</span><span>{s.description}</span></li>)}</ul>
            </div>
            {wantsBot && (
              <div className="mt-4">
                <label className="label">Add to server</label>
                {info.guilds.length === 0 ? <p className="text-sm text-danger">You do not manage any server to add the bot to.</p> : (
                  <select className="input" value={guild} onChange={(e) => setGuild(e.target.value)} data-oauth-guild>{info.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                )}
              </div>
            )}
            {err && <p className="mt-3 text-sm text-danger" data-oauth-error>{err}</p>}
            <p className="mt-4 text-[11px] text-text-2">You will be sent to <span className="break-all">{info.redirect_uri}</span>. Authorising does not share your password.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={cancel} data-oauth-cancel>Cancel</button>
              <button type="button" className="btn-primary flex-1" onClick={approve} disabled={busy || (wantsBot && !guild)} data-oauth-approve>Authorise</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
