import { useEffect, useState } from 'react'
import { Bot, Copy } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { AuthorizedApp } from '../../../lib/types'

const MCP_SCOPES: Record<string, string> = { 'mcp.read': 'Read', 'mcp.notifications': 'Notifications', 'mcp.send': 'Send messages', 'mcp.manage': 'Manage servers' }
interface McpGrant { id: string; name: string; client_uri: string | null; scopes: string[]; since: string; last_used_at: string | null }

const SCOPE_LABELS: Record<string, string> = { identify: 'Read your profile', email: 'Read your email', guilds: 'See your servers', 'messages.read': 'Read messages', 'messages.write': 'Send messages as you', bot: 'Add its bot to servers' }

/** Settings → Authorized Apps: third-party apps holding a token for your account, with Deauthorize. */
export default function AuthorizedAppsTab() {
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<AuthorizedApp[] | null>(null)
  const load = () => api.get<AuthorizedApp[]>('/users/@me/authorized-apps').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const revoke = async (a: AuthorizedApp) => { try { await api.delete(`/users/@me/authorized-apps/${a.id}`); pushToast(`${a.name} can no longer access your account`); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-6" data-authorized-apps>
      <h2 className="text-xl font-bold">Authorized Apps</h2>
      <p className="text-sm text-text-2">Apps you let in with "Authorise". Each keeps only the access listed; deauthorising ends it at once.</p>
      {list === null && <p className="text-sm text-text-2">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-text-2">No apps have access to your account.</p>}
      <ul className="space-y-2">
        {list?.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5" data-authorized-app={a.id}>
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-md bg-bg-3 text-sm font-bold flex items-center justify-center">{a.name[0]}</span>
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{a.name}</div><div className="text-xs text-text-2 truncate">{a.owner ? `by ${a.owner} · ` : ''}authorised {new Date(a.since).toLocaleDateString()}</div></div>
              <button type="button" onClick={() => revoke(a)} className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" data-deauthorize>Deauthorize</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{a.scopes.map((s) => <li key={s} className="rounded-full bg-bg-3 px-2 py-0.5 text-xs" data-scope={s}>{SCOPE_LABELS[s] ?? s}</li>)}</ul>
          </li>
        ))}
      </ul>
      <McpSection />
    </div>
  )
}

/** AI assistants connected over MCP: the address to paste into them, and the ones you approved, with Disconnect. */
function McpSection() {
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<McpGrant[] | null>(null)
  const url = `${window.location.origin}/mcp`
  const load = () => api.get<McpGrant[]>('/users/@me/mcp-grants').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const revoke = async (g: McpGrant) => { try { await api.delete(`/users/@me/mcp-grants/${g.id}`); pushToast(`${g.name} is disconnected`); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const copy = () => { void navigator.clipboard?.writeText(url).then(() => pushToast('MCP address copied')).catch(() => {}) }
  return (
    <section className="space-y-3 border-t border-line pt-5" data-mcp-section>
      <h3 className="text-base font-bold flex items-center gap-2"><Bot size={18} /> AI assistants (MCP)</h3>
      <p className="text-sm text-text-2">Let Claude, ChatGPT, Cursor or another assistant that supports MCP read and send messages for you. Add this address as a custom connector (remote MCP server) in the assistant, then approve it on the page it opens.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg-0 px-3 py-2 text-sm" data-mcp-url>{url}</code>
        <button type="button" onClick={copy} className="btn-ghost border border-line px-3 py-2" title="Copy" data-mcp-copy><Copy size={16} /></button>
      </div>
      {list?.length === 0 && <p className="text-sm text-text-2">No assistants are connected.</p>}
      <ul className="space-y-2">
        {list?.map((g) => (
          <li key={g.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5" data-mcp-grant={g.id}>
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-md bg-bg-3 flex items-center justify-center"><Bot size={18} /></span>
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{g.name}</div><div className="text-xs text-text-2 truncate">connected {new Date(g.since).toLocaleDateString()}{g.last_used_at ? ` · last used ${new Date(g.last_used_at).toLocaleString()}` : ''}</div></div>
              <button type="button" onClick={() => revoke(g)} className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" data-mcp-disconnect>Disconnect</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{g.scopes.map((s) => <li key={s} className="rounded-full bg-bg-3 px-2 py-0.5 text-xs" data-scope={s}>{MCP_SCOPES[s] ?? s}</li>)}</ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
