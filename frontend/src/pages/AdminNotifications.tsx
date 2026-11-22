import { Hash, Link2, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

type Category = 'users' | 'servers' | 'safety' | 'console'
interface ChannelRef { id: string; name?: string; guild_id?: string; guild_name?: string; missing?: boolean }
interface Route { channel: ChannelRef | null; webhook: { host: string } | null; last_error: { message: string; at: string } | null }
interface Routes { categories: Category[]; routes: Record<Category, Route> }
interface Result { ok: boolean; error?: string }

/**
 * Admin › Notifications: where the instance's events go. Each category posts to a text channel on the instance (as
 * the Parley account) and/or a webhook (Discord, Slack or any JSON endpoint), with links into the console.
 */
export default function NotificationsPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<Routes | null>(null)
  useEffect(() => { api.get<Routes>('/admin/event-routes').then(setData).catch((e) => pushToast((e as Error).message, 'error')) }, [pushToast])
  const save = async (cat: Category, body: Record<string, unknown>, done?: string) => {
    try { setData(await api.put<Routes>('/admin/event-routes', { [cat]: body })); if (done) pushToast(done); return true } catch (e) { pushToast((e as Error).message, 'error'); return false }
  }
  const about: Record<Category, { title: string; what: string }> = {
    users: { title: t('Users'), what: t('New accounts, accounts being deleted, and admins suspending, deleting or promoting people.') },
    servers: { title: t('Servers'), what: t('Servers made, handed to a new owner, deleted or restored, taken down, and discovery changes.') },
    safety: { title: t('Safety'), what: t('New reports, uploads matching known abuse material, spam flags, age check requests, restrictions and cases.') },
    console: { title: t('Console activity'), what: t('Everything any admin does in this console, as the audit log records it.') },
  }
  return (
    <div className="max-w-3xl space-y-5" data-admin-notifications>
      <div>
        <h1 className="text-xl font-bold">{t('Notifications')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Send what happens on this instance to a channel, a webhook, or both. Each post links to the right page of this console. Anyone who can see the channel sees the posts, so pick one only your team can read.')}</p>
      </div>
      {data === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {data?.categories.map((c) => <CategoryCard key={c} cat={c} title={about[c].title} what={about[c].what} route={data.routes[c]} save={save} />)}
    </div>
  )
}

function CategoryCard({ cat, title, what, route, save }: { cat: Category; title: string; what: string; route: Route; save: (cat: Category, body: Record<string, unknown>, done?: string) => Promise<boolean> }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [picking, setPicking] = useState(false)
  const [hook, setHook] = useState('')
  const [editingHook, setEditingHook] = useState(false)
  const [testing, setTesting] = useState(false)
  const ch = route.channel
  const test = async () => {
    setTesting(true)
    try {
      const r = await api.post<{ channel: Result | null; webhook: Result | null }>(`/admin/event-routes/${cat}/test`, {})
      const bad = [r.channel, r.webhook].find((x) => x && !x.ok)
      if (bad) pushToast(t('Test failed: {error}', { error: bad.error ?? '' }), 'error'); else pushToast(t('Test sent'))
    } catch (e) { pushToast((e as Error).message, 'error') }
    setTesting(false)
  }
  return (
    <section className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-notify-category={cat}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0"><h2 className="font-semibold text-text-0">{title}</h2><p className="text-sm text-text-2">{what}</p></div>
        <button type="button" className="btn-ghost shrink-0 inline-flex items-center gap-1.5" disabled={testing || (!ch && !route.webhook)} onClick={test} data-notify-test={cat}><Send size={14} />{t('Send a test')}</button>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-2">{t('Channel')}</div>
        {ch && !picking ? (
          <div className="flex items-center gap-2 text-sm" data-notify-channel={ch.id}>
            <Hash size={15} className="text-text-2" />
            {ch.missing ? <span className="text-danger">{t('The channel was deleted')}</span> : <span><span className="font-medium text-text-0">{ch.name}</span> <span className="text-text-2">{t('in {server}', { server: ch.guild_name ?? '' })}</span></span>}
            <span className="flex-1" />
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => setPicking(true)}>{t('Change')}</button>
            <button type="button" className="text-text-2 hover:text-danger" title={t('Remove')} onClick={() => save(cat, { channel_id: null })} data-notify-channel-remove><Trash2 size={15} /></button>
          </div>
        ) : picking || !ch ? (
          <ChannelPicker onPick={async (id) => { if (await save(cat, { channel_id: id }, t('Saved'))) setPicking(false) }} onCancel={ch ? () => setPicking(false) : undefined} />
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-2">{t('Webhook')}</div>
        {route.webhook && !editingHook ? (
          <div className="flex items-center gap-2 text-sm" data-notify-webhook={route.webhook.host}>
            <Link2 size={15} className="text-text-2" /><span>{t('Posting to {host}', { host: route.webhook.host })}</span>
            <span className="flex-1" />
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => setEditingHook(true)}>{t('Replace')}</button>
            <button type="button" className="text-text-2 hover:text-danger" title={t('Remove')} onClick={() => save(cat, { webhook_url: '' })} data-notify-webhook-remove><Trash2 size={15} /></button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 min-w-56" type="url" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={(e) => setHook(e.target.value)} data-notify-webhook-input={cat} />
            <button type="button" className="btn-primary" disabled={!hook.trim()} onClick={async () => { if (await save(cat, { webhook_url: hook }, t('Saved'))) { setHook(''); setEditingHook(false) } }} data-notify-webhook-save={cat}>{t('Save')}</button>
            {editingHook && <button type="button" className="btn-ghost" onClick={() => { setHook(''); setEditingHook(false) }}>{t('Cancel')}</button>}
          </div>
        )}
        <p className="text-xs text-text-2">{t('Discord and Slack webhooks get posts in their own format; any other address gets JSON with the event and its links.')}</p>
      </div>

      {route.last_error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" data-notify-error={cat}>{t('The last post failed: {error}', { error: route.last_error.message })}</p>}
    </section>
  )
}

function ChannelPicker({ onPick, onCancel }: { onPick: (id: string) => void; onCancel?: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [list, setList] = useState<ChannelRef[] | null>(null)
  useEffect(() => {
    const h = setTimeout(() => { api.get<ChannelRef[]>(`/admin/event-routes/channels?q=${encodeURIComponent(q)}`).then(setList).catch(() => setList([])) }, 200)
    return () => clearTimeout(h)
  }, [q])
  return (
    <div className="space-y-2" data-notify-picker>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={t('Search channels and servers')} value={q} onChange={(e) => setQ(e.target.value)} data-notify-channel-search />
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>}
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-line divide-y divide-line">
        {list === null && <p className="p-2 text-sm text-text-2">{t('Loading…')}</p>}
        {list?.length === 0 && <p className="p-2 text-sm text-text-2">{t('No text channels match.')}</p>}
        {list?.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-3" data-notify-channel-option={c.id}>
            <Hash size={14} className="text-text-2" /><span className="font-medium text-text-0">{c.name}</span><span className="truncate text-text-2">{c.guild_name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
