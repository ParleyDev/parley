import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, ShieldAlert } from 'lucide-react'
import { APP_NAME } from '../lib/brand'
import { LogoNeon } from '../components/Logo'
import { api } from '../lib/api'
import { useStore } from '../store'
import Avatar from '../components/Avatar'

interface Info { client: { name: string; client_uri: string | null }; redirect_uri: string; redirect_host: string; scopes: { id: string; description: string; requested: boolean }[] }

const LABEL: Record<string, string> = { 'mcp.read': 'Read', 'mcp.notifications': 'Notifications', 'mcp.send': 'Send messages', 'mcp.manage': 'Manage servers' }

/**
 * /oauth2/mcp/authorize: the consent screen for an AI assistant connecting over MCP (Claude, ChatGPT, Cursor…).
 * The backend's /oauth/authorize sends clients here with the OAuth query intact; approving posts it back with the
 * permissions the user left ticked and follows the redirect to the client.
 */
export default function McpAuthorizePage() {
  const [params] = useSearchParams()
  const me = useStore((s) => s.user)
  const [info, setInfo] = useState<Info | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const q = Object.fromEntries(params.entries())
  useEffect(() => {
    api.get<Info>(`/mcp/consent?${params.toString()}`).then((i) => { setInfo(i); setPicked(i.scopes.filter((s) => s.requested).map((s) => s.id)) }).catch((e: Error) => setErr(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const answer = async (approve: boolean) => {
    setBusy(true); setErr(null)
    try { const r = await api.post<{ redirect: string }>('/mcp/consent', { ...q, approve, scopes: picked }); window.location.href = r.redirect } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center p-4 bg-bg-0">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1/90 border border-line p-6 shadow-2xl" data-mcp-consent>
        <div className="flex items-center justify-center gap-3">
          <LogoNeon className="h-12 w-12 rounded-xl" />
          <span className="text-text-2">⇄</span>
          <div className="h-12 w-12 rounded-xl bg-bg-3 flex items-center justify-center"><Bot size={24} /></div>
        </div>
        {err && !info && <p className="mt-6 text-center text-sm text-danger" data-mcp-error>{err}</p>}
        {info && (
          <>
            <h1 className="mt-5 text-center text-lg font-bold" data-mcp-client>{info.client.name}</h1>
            <p className="text-center text-sm text-text-2">wants to connect to your {APP_NAME} account as an AI assistant</p>
            {me && <div className="mt-4 flex items-center justify-center gap-2 text-sm"><Avatar user={me} size={24} /><span>Signed in as <b>{me.display_name}</b></span></div>}
            <div className="mt-5 rounded-xl border border-line bg-bg-0/60 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">Allow it to</div>
              <ul className="space-y-2 text-sm">
                {info.scopes.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-start gap-2.5 cursor-pointer" data-mcp-scope={s.id}>
                      <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                      <span><b className="font-semibold">{LABEL[s.id] ?? s.id}</b><span className="block text-text-2">{s.description}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {picked.includes('mcp.manage') && <p className="mt-3 flex items-start gap-2 text-xs text-warn" data-mcp-manage-warning><ShieldAlert size={14} className="mt-0.5 shrink-0" />It could delete messages and remove people wherever your account is allowed to. Only allow this for an assistant you trust.</p>}
            <p className="mt-3 text-xs text-text-2">Anything it sends appears under your name. It never sees your password, and you can disconnect it any time in User Settings → Authorized Apps.</p>
            {err && <p className="mt-3 text-sm text-danger" data-mcp-error>{err}</p>}
            <p className="mt-3 text-[11px] text-text-2">You will return to <span className="break-all font-medium" data-mcp-redirect-host>{info.redirect_host}</span>.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => answer(false)} disabled={busy} data-mcp-deny>Cancel</button>
              <button type="button" className="btn-primary flex-1" onClick={() => answer(true)} disabled={busy || picked.length === 0} data-mcp-approve>Allow</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
