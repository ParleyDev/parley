import { Hash, MessageSquareText, Volume2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { EMPTY_ROLES, has, P, sortedRoles } from '../../lib/perms'
import { myChannelPerms, useStore } from '../../store'
import Modal from '../Modal'
import { LinkedRolesList } from '../LinkedRoles'

/** Browse Channels (show or hide channels in your list) and Channels & Roles (roles you can pick yourself). */
export default function BrowseChannelsModal({ onClose, guildId, tab: initial = 'channels' }: { onClose: () => void; guildId: string; tab?: 'channels' | 'roles' }) {
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const me = useStore((s) => s.user?.id)
  const myRoles = useStore((s) => (me ? s.members[guildId]?.[me]?.roles : undefined) ?? [])
  const hidden = useStore((s) => s.customize[guildId]?.hidden ?? [])
  const setHidden = useStore((s) => s.setHidden)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [tab, setTab] = useState(initial)
  const all = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind !== 'thread').sort((a, b) => a.position - b.position), [channels, guildId])
  const cats = all.filter((c) => c.kind === 'category')
  const visible = all.filter((c) => c.kind !== 'category' && has(myChannelPerms(useStore.getState(), c.id), P.VIEW_CHANNEL))
  const groups = [{ id: '', name: 'No category' }, ...cats].map((g) => ({ ...g, list: visible.filter((c) => (c.parent_id ?? '') === g.id) })).filter((g) => g.list.length)
  const save = async (next: string[]) => { setHidden(guildId, next); try { await api.put(`/guilds/${guildId}/me/hidden-channels`, { channel_ids: next }) } catch (e) { pushToast((e as Error).message, 'error') } }
  const toggle = (id: string) => save(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])
  const pickable = sortedRoles(roles).filter((r) => r.self_assignable)
  const toggleRole = async (rid: string, on: boolean) => { try { if (on) await api.put(`/guilds/${guildId}/me/roles/${rid}`); else await api.delete(`/guilds/${guildId}/me/roles/${rid}`) } catch (e) { pushToast((e as Error).message, 'error') } }
  if (!guild) return null
  const icon = (k: string) => (k === 'voice' || k === 'stage' ? <Volume2 size={16} /> : k === 'forum' ? <MessageSquareText size={16} /> : <Hash size={16} />)
  return (
    <Modal title={tab === 'channels' ? 'Browse Channels' : 'Channels & Roles'} subtitle={guild.name} onClose={onClose} width="max-w-lg">
      <div className="mb-3 flex gap-1.5">
        {(['channels', 'roles'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tab === t ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-browse-tab={t}>{t === 'channels' ? 'Browse Channels' : 'Roles'}</button>)}
      </div>
      {tab === 'channels' ? (
        <div className="max-h-[55vh] space-y-3 overflow-y-auto" data-browse-channels>
          <p className="text-xs text-text-2">Untick channels you don't want in your channel list. You can still open them from here or with a link.</p>
          {groups.map((g) => (
            <section key={g.id || 'none'}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{g.name}</div>
              {g.list.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-3 cursor-pointer" data-browse-channel={c.id}>
                  <span className="text-text-2">{icon(c.kind)}</span><span className="flex-1 truncate">{c.name}</span>
                  <input type="checkbox" className="h-4 w-4 accent-accent" checked={!hidden.includes(c.id)} onChange={() => toggle(c.id)} />
                </label>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3" data-browse-roles>
          <LinkedRolesList guildId={guildId} />
          {pickable.length === 0 ? <p className="text-sm text-text-2">This server has no roles you can pick yourself.</p> : pickable.map((r) => (
            <label key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm cursor-pointer" data-browse-role={r.id}>
              <span className="h-3 w-3 rounded-full" style={{ background: r.color ?? '#99aab5' }} /><span className="flex-1">{r.name}</span>
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={myRoles.includes(r.id)} onChange={(e) => toggleRole(r.id, e.target.checked)} />
            </label>
          ))}
          {(guild.onboarding?.questions?.length ?? 0) > 0 && guild.onboarding?.enabled && <button type="button" className="text-sm text-sky-400 hover:underline" onClick={() => openModal({ kind: 'onboarding', guildId })} data-browse-onboarding>Answer the server's questions again</button>}
        </div>
      )}
    </Modal>
  )
}
