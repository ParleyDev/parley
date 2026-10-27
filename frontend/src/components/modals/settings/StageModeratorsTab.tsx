import { Shield, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../lib/api'
import { has, P } from '../../../lib/perms'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

const MOD = P.MUTE_MEMBERS | P.MOVE_MEMBERS

/**
 * Channel Settings › Stage Moderators (stage channels): roles and members who can run this stage without Manage
 * Channels. Being one means holding Mute Members and Move Members here, which the stage treats as moderator.
 */
export default function StageModeratorsTab({ channelId }: { channelId: string }) {
  const t = useT()
  const channel = useStore((s) => s.channels[channelId])
  const guildId = channel?.guild_id ?? ''
  const roles = useStore((s) => s.roles[guildId])
  const members = useStore((s) => s.members[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [pick, setPick] = useState('')
  if (!channel) return null
  const ows = channel.overwrites ?? []
  const mods = ows.filter((o) => has(o.allow, P.MUTE_MEMBERS) && has(o.allow, P.MOVE_MEMBERS))
  const nameOf = (id: string, kind: 'role' | 'member') => kind === 'role' ? (id === guildId ? '@everyone' : `@${roles?.[id]?.name ?? t('role')}`) : (members?.[id]?.nickname || members?.[id]?.display_name || t('member'))
  const add = async () => {
    const [kind, id] = pick.split(':') as ['role' | 'member', string]
    if (!id) return
    const cur = ows.find((o) => o.id === id)
    try { await api.put(`/channels/${channelId}/permissions/${id}`, { kind, allow: (cur?.allow ?? 0) | MOD, deny: (cur?.deny ?? 0) & ~MOD }); setPick('') } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const remove = async (id: string) => {
    const cur = ows.find((o) => o.id === id)
    if (!cur) return
    const allow = cur.allow & ~MOD
    try {
      if (allow === 0 && cur.deny === 0) await api.delete(`/channels/${channelId}/permissions/${id}`)
      else await api.put(`/channels/${channelId}/permissions/${id}`, { kind: cur.kind, allow, deny: cur.deny })
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const taken = new Set(mods.map((m) => m.id))
  return (
    <div className="space-y-4" data-stage-mods>
      <div><h2 className="text-xl font-bold">{t('Stage Moderators')}</h2><p className="mt-1 text-sm text-text-2">{t('Moderators join as speakers, invite people up to speak and move them back to the audience. Anyone with Manage Channels already can.')}</p></div>
      <div className="space-y-1.5">
        {mods.length === 0 && <p className="text-sm text-text-2">{t('No stage moderators yet.')}</p>}
        {mods.map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-stage-mod={m.id}>
            <Shield size={15} className="text-text-2" /><span className="flex-1 font-semibold">{nameOf(m.id, m.kind)}</span>
            <button type="button" title={t('Remove')} className="h-7 w-7 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger" onClick={() => void remove(m.id)} data-stage-mod-remove={m.id}><X size={15} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <select className="input flex-1" value={pick} onChange={(e) => setPick(e.target.value)} data-stage-mod-pick>
          <option value="">{t('Add a role or member…')}</option>
          <optgroup label={t('Roles')}>{Object.values(roles ?? {}).filter((r) => r.id !== guildId && !taken.has(r.id)).sort((a, b) => b.position - a.position).map((r) => <option key={r.id} value={`role:${r.id}`}>@{r.name}</option>)}</optgroup>
          <optgroup label={t('Members')}>{Object.values(members ?? {}).filter((m) => !taken.has(m.user_id)).slice(0, 200).map((m) => <option key={m.user_id} value={`member:${m.user_id}`}>{m.nickname || m.display_name}</option>)}</optgroup>
        </select>
        <button type="button" className="btn-primary" disabled={!pick} onClick={() => void add()} data-stage-mod-add>{t('Add')}</button>
      </div>
    </div>
  )
}
