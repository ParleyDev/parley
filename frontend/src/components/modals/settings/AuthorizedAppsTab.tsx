import { useEffect, useState } from 'react'
import { Bot, Copy } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { t as tr, useT } from '../../../lib/i18n'
import type { AuthorizedApp } from '../../../lib/types'

const mcpScopes = (): Record<string, string> => ({ 'mcp.read': tr('Read'), 'mcp.notifications': tr('Notifications'), 'mcp.send': tr('Send messages'), 'mcp.manage': tr('Manage servers') })
interface McpGrant { id: string; name: string; client_uri: string | null; scopes: string[]; since: string; last_used_at: string | null }

const scopeLabels = (): Record<string, string> => ({ identify: tr('Read your profile'), email: tr('Read your email'), guilds: tr('See your servers'), 'messages.read': tr('Read messages'), 'messages.write': tr('Send messages as you'), bot: tr('Add its bot to servers') })

/** Settings → Authorized Apps: third-party apps holding a token for your account, with Deauthorize. */
export default function AuthorizedAppsTab() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<AuthorizedApp[] | null>(null)
  const load = () => api.get<AuthorizedApp[]>('/users/@me/authorized-apps').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const revoke = async (a: AuthorizedApp) => { try { await api.delete(`/users/@me/authorized-apps/${a.id}`); pushToast(t('{name} can no longer access your account', { name: a.name })); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-6" data-authorized-apps>
      <h2 className="text-xl font-bold">{t('Authorized Apps')}</h2>
      <p className="text-sm text-text-2">{t('Apps you let in with "Authorise". Each keeps only the access listed; deauthorising ends it at once.')}</p>
      {list === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {list?.length === 0 && <p className="text-sm text-text-2">{t('No apps have access to your account.')}</p>}
      <ul className="space-y-2">
        {list?.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5" data-authorized-app={a.id}>
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-md bg-bg-3 text-sm font-bold flex items-center justify-center">{a.name[0]}</span>
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{a.name}</div><div className="text-xs text-text-2 truncate">{a.owner ? `${t('by {owner}', { owner: a.owner })} · ` : ''}{t('authorised {date}', { date: new Date(a.since).toLocaleDateString() })}</div></div>
              <button type="button" onClick={() => revoke(a)} className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" data-deauthorize>{t('Deauthorize')}</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{a.scopes.map((s) => <li key={s} className="rounded-full bg-bg-3 px-2 py-0.5 text-xs" data-scope={s}>{scopeLabels()[s] ?? s}</li>)}</ul>
          </li>
        ))}
      </ul>
      <InstalledApps />
      <McpSection />
    </div>
  )
}

/** AI assistants connected over MCP: the address to paste into them, and the ones you approved, with Disconnect. */
function McpSection() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<McpGrant[] | null>(null)
  const url = `${window.location.origin}/mcp`
  const load = () => api.get<McpGrant[]>('/users/@me/mcp-grants').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const revoke = async (g: McpGrant) => { try { await api.delete(`/users/@me/mcp-grants/${g.id}`); pushToast(t('{name} is disconnected', { name: g.name })); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const copy = () => { void navigator.clipboard?.writeText(url).then(() => pushToast(t('MCP address copied'))).catch(() => {}) }
  return (
    <section className="space-y-3 border-t border-line pt-5" data-mcp-section>
      <h3 className="text-base font-bold flex items-center gap-2"><Bot size={18} /> {t('AI assistants (MCP)')}</h3>
      <p className="text-sm text-text-2">{t('Let Claude, ChatGPT, Cursor or another assistant that supports MCP read and send messages for you. Add this address as a custom connector (remote MCP server) in the assistant, then approve it on the page it opens.')}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg-0 px-3 py-2 text-sm" data-mcp-url>{url}</code>
        <button type="button" onClick={copy} className="btn-ghost border border-line px-3 py-2" title={t('Copy')} data-mcp-copy><Copy size={16} /></button>
      </div>
      {list?.length === 0 && <p className="text-sm text-text-2">{t('No assistants are connected.')}</p>}
      <ul className="space-y-2">
        {list?.map((g) => (
          <li key={g.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5" data-mcp-grant={g.id}>
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-md bg-bg-3 flex items-center justify-center"><Bot size={18} /></span>
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{g.name}</div><div className="text-xs text-text-2 truncate">{t('connected {date}', { date: new Date(g.since).toLocaleDateString() })}{g.last_used_at ? ` · ${t('last used {date}', { date: new Date(g.last_used_at).toLocaleString() })}` : ''}</div></div>
              <button type="button" onClick={() => revoke(g)} className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" data-mcp-disconnect>{t('Disconnect')}</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{g.scopes.map((s) => <li key={s} className="rounded-full bg-bg-3 px-2 py-0.5 text-xs" data-scope={s}>{mcpScopes()[s] ?? s}</li>)}</ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Apps installed to your account: their commands work for you anywhere. */
function InstalledApps() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<{ id: string; name: string; description: string; icon_url: string | null; installed_at: string }[]>([])
  useEffect(() => { api.get<typeof list>('/users/@me/app-installs').then(setList).catch(() => setList([])) }, [])
  return (
    <section className="space-y-2" data-installed-apps>
      <div className="flex items-center justify-between"><h3 className="font-bold">{t('My Apps')}</h3><a href="/app-directory" className="text-sm text-sky-400 hover:underline" data-open-directory>{t('Browse the App Directory')}</a></div>
      {list.length === 0 ? <p className="text-sm text-text-2">{t('No apps installed to your account. Apps you add here work for you in any server or DM.')}</p> : list.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg-1 px-3 py-2" data-installed-app={a.id}>
          {a.icon_url ? <img src={a.icon_url} alt="" className="h-9 w-9 rounded-md" /> : <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-3 text-sm font-bold">{a.name[0]}</span>}
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{a.name}</div><div className="text-xs text-text-2">{t('added {date}', { date: new Date(a.installed_at).toLocaleDateString() })}</div></div>
          <button type="button" className="btn-ghost text-sm" onClick={async () => { try { await api.delete(`/users/@me/app-installs/${a.id}`); setList(list.filter((x) => x.id !== a.id)) } catch (e) { pushToast((e as Error).message, 'error') } }} data-uninstall-app={a.id}>{t('Remove')}</button>
        </div>
      ))}
    </section>
  )
}
