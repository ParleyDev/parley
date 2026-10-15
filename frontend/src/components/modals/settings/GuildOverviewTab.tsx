import { Crown } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import ImagePicker from '../ImagePicker'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { Guild } from '../../../lib/types'

export default function GuildOverviewTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const me = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const ownerMember = useStore((s) => (guild ? s.members[guildId]?.[guild.owner_id] : undefined))
  const pushToast = useStore((s) => s.pushToast)
  const [name, setName] = useState(guild?.name ?? '')
  const [icon, setIcon] = useState<string | null>(guild?.icon_url ?? null)
  const [banner, setBanner] = useState<string | null>(guild?.banner_url ?? null)
  const [busy, setBusy] = useState(false)
  if (!guild) return null
  const dirty = name !== guild.name || (icon ?? null) !== (guild.icon_url ?? null) || (banner ?? null) !== (guild.banner_url ?? null)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const g = await api.patch<Guild>(`/guilds/${guildId}`, { name, icon_url: icon ?? '', banner_url: banner ?? '' })
      upsertGuild(g); pushToast('Server updated')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-xl font-bold">Server Overview</h1>
      <div className="flex items-start gap-6 max-md:flex-col">
        <ImagePicker value={icon} onChange={setIcon} label={name} id={guildId} kind="icon" />
        <div className="flex-1 w-full"><label className="label">Server name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      </div>
      <div>
        <label className="label">Server banner</label>
        <div className="flex items-center gap-4"><ImagePicker value={banner} onChange={setBanner} label={name} id={guildId} round={false} kind="banner" /><p className="text-xs text-text-2">Shown above the channel list and on your Discover card. GIF, APNG and WebP animations are kept.</p></div>
      </div>
      <div className="rounded-xl bg-bg-0/50 border border-line p-4">
        <div className="flex items-center gap-2 font-semibold"><Crown size={16} className="text-warn" /> Server owner</div>
        <p className="text-sm text-text-2 mt-1">
          {guild.owner_id === me?.id ? 'You own this server. Transferring ownership hands over full control, including deleting the server.' : `This server is owned by ${ownerMember ? (ownerMember.nickname ?? ownerMember.display_name) : 'another member'}.`}
        </p>
        {guild.owner_id === me?.id && <button type="button" className="btn-ghost mt-3" onClick={() => openModal({ kind: 'transferOwnership', guildId })}><Crown size={16} /> Transfer Ownership</button>}
      </div>
      {dirty && (
        <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">Careful — you have unsaved changes!</span>
          <button type="button" className="btn-ghost" onClick={() => { setName(guild.name); setIcon(guild.icon_url); setBanner(guild.banner_url ?? null) }}>Reset</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !name.trim()}>Save Changes</button>
        </div>
      )}
    </form>
  )
}
