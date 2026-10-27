import { useState } from 'react'
import { api } from '../lib/api'
import type { Guild } from '../lib/types'
import { useStore } from '../store'

/** Server Settings › Overview: the server's official tag (2-4 letters) and badge, which members can wear. */
export function ServerTagEditor({ guild }: { guild: Guild }) {
  const pushToast = useStore((s) => s.pushToast)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [tag, setTag] = useState(guild.tag ?? '')
  const [badge, setBadge] = useState(guild.tag_badge ?? '')
  const save = async () => { try { upsertGuild(await api.put<Guild>(`/guilds/${guild.id}/tag`, { tag: tag || null, badge })); pushToast(tag ? 'Server tag saved' : 'Server tag removed') } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-3 space-y-2" data-server-tag-editor>
      <div className="font-semibold">Server tag</div>
      <p className="text-xs text-text-2">A short tag members can wear next to their name, everywhere. Changing it changes everyone's; removing it takes it off.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-14 px-0 text-center text-lg" value={badge} maxLength={8} onChange={(e) => setBadge(e.target.value)} placeholder="✨" aria-label="Badge" data-server-tag-badge />
        <input className="input w-28 uppercase" value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="TAG" data-server-tag-input />
        <button type="button" className="btn-primary py-1.5" onClick={save} disabled={!!tag && tag.length < 2} data-server-tag-save>Save tag</button>
      </div>
    </div>
  )
}

/** Profile: wear one of your servers' tags instead of typing your own. */
export function WearServerTag() {
  const me = useStore((s) => s.user)
  const guilds = useStore((s) => s.guilds)
  const pushToast = useStore((s) => s.pushToast)
  const tagged = Object.values(guilds).filter((g) => g.tag)
  const current = (me as { clan_tag_guild?: string | null } | null)?.clan_tag_guild ?? ''
  if (!tagged.length) return null
  const wear = async (gid: string) => { try { await api.put('/users/@me/server-tag', { guild_id: gid || null }); pushToast(gid ? 'Wearing the server tag' : 'Server tag removed') } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div data-wear-server-tag>
      <label className="label">Or wear a server's tag</label>
      <select className="input w-auto" value={current} onChange={(e) => wear(e.target.value)} data-wear-tag-select>
        <option value="">None</option>
        {tagged.map((g) => <option key={g.id} value={g.id}>{g.tag_badge ? `${g.tag_badge} ` : ''}{g.tag} · {g.name}</option>)}
      </select>
    </div>
  )
}
