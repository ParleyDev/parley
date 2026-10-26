import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import type { Guild, InviteListing } from '../../../lib/types'
import { useStore } from '../../../store'
import { publicOrigin } from '../../InviteCard'
import ImagePicker from '../ImagePicker'

/** Server Settings › Widget: a public widget (JSON and an embeddable page) and the invite page's background. */
export default function WidgetTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [invites, setInvites] = useState<InviteListing[] | null>(null)
  useEffect(() => { api.get<InviteListing[]>(`/guilds/${guildId}/invites`).then(setInvites).catch(() => setInvites([])) }, [guildId])
  if (!guild) return null
  const save = async (patch: Record<string, unknown>, done = 'Saved') => { try { upsertGuild(await api.patch<Guild>(`/guilds/${guildId}`, patch)); pushToast(done) } catch (e) { pushToast((e as Error).message, 'error') } }
  const base = publicOrigin()
  const embed = `<iframe src="${base}/widget/${guildId}" width="350" height="500" allowtransparency="true" frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe>`
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); pushToast(`${what} copied`) } catch { pushToast('Clipboard unavailable', 'error') } }
  return (
    <div className="space-y-8" data-widget-tab>
      <div>
        <h1 className="text-xl font-bold">Widget</h1>
        <p className="mt-1 text-sm text-text-2">Show who's online in {guild.name} on your website, with a button to join.</p>
      </div>
      <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
        <span><span className="block text-sm font-semibold">Enable Server Widget</span><span className="block text-xs text-text-2">Anyone with the link can see the server name, how many are online and their names and avatars.</span></span>
        <input type="checkbox" className="h-5 w-5 accent-accent" checked={!!guild.widget_enabled} onChange={(e) => save({ widget_enabled: e.target.checked }, e.target.checked ? 'Widget on' : 'Widget off')} data-widget-enabled />
      </label>
      <div>
        <label className="label" htmlFor="widget-invite">Join button invite</label>
        <select id="widget-invite" className="input w-auto max-w-full" value={guild.widget_invite ?? ''} onChange={(e) => save({ widget_invite: e.target.value })} data-widget-invite>
          <option value="">No Join button</option>
          {(invites ?? []).filter((i) => !i.max_uses && !i.expires_at).map((i) => <option key={i.code} value={i.code}>{i.code}</option>)}
        </select>
        <p className="mt-1 text-xs text-text-2">Only invites that never expire are listed. Make one in Invites.</p>
      </div>
      <div className="space-y-2">
        <label className="label">Premade widget</label>
        <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={embed} data-widget-embed /><button type="button" className="btn-ghost bg-bg-3 shrink-0" onClick={() => copy('Embed code', embed)}><Copy size={14} /> Copy</button></div>
        <label className="label pt-2">JSON API</label>
        <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={`${base}/api/guilds/${guildId}/widget.json`} data-widget-json /><button type="button" className="btn-ghost bg-bg-3 shrink-0" onClick={() => copy('Link', `${base}/api/guilds/${guildId}/widget.json`)}><Copy size={14} /> Copy</button></div>
        {guild.widget_enabled && <a className="inline-block text-sm text-sky-400 hover:underline" href={`/widget/${guildId}`} target="_blank" rel="noreferrer" data-widget-preview>Open the widget</a>}
      </div>
      <div>
        <label className="label">Invite background</label>
        <div className="flex items-center gap-4">
          <ImagePicker value={guild.invite_splash_url ?? null} onChange={(url) => save({ invite_splash_url: url ?? '' }, url ? 'Invite background set' : 'Invite background removed')} label={guild.name} id={guildId} round={false} kind="banner" />
          <p className="text-xs text-text-2">Shown behind the card on your invite page.</p>
        </div>
      </div>
    </div>
  )
}
