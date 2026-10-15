import { Compass, Crown, Gavel, Shield, SlidersHorizontal, Smile, Sticker, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { myGuildPerms, useStore } from '../../store'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import SettingsShell from './SettingsShell'
import GuildOverviewTab from './settings/GuildOverviewTab'
import RolesTab from './settings/RolesTab'
import MembersTab from './settings/MembersTab'
import BansTab from './settings/BansTab'
import EmojiTab from './settings/EmojiTab'
import StickersTab from './settings/StickersTab'
import DiscoveryTab from './settings/DiscoveryTab'

type Tab = 'overview' | 'roles' | 'members' | 'bans' | 'emoji' | 'stickers' | 'discovery'

export default function GuildSettingsModal({ onClose, guildId, tab: initial = 'overview' }: { onClose: () => void; guildId: string; tab?: Tab }) {
  const guild = useStore((s) => s.guilds[guildId])
  const user = useStore((s) => s.user)
  const perms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const removeGuild = useStore((s) => s.removeGuild)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const canOverview = has(perms, P.MANAGE_GUILD)
  const canBans = has(perms, P.BAN_MEMBERS)
  const [tab, setTab] = useState<Tab>(((initial === 'overview' || initial === 'emoji' || initial === 'stickers' || initial === 'discovery') && !canOverview) || (initial === 'bans' && !canBans) ? 'roles' : initial)
  if (!guild) return null
  const isOwner = guild.owner_id === user?.id

  const del = () => openModal({
    kind: 'confirm', title: `Delete '${guild.name}'`, body: `Are you sure you want to delete ${guild.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Server',
    action: async () => {
      try { await api.delete(`/guilds/${guildId}`); removeGuild(guildId); navigate('/channels/@me') } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })

  const items: { id: Tab; label: string; icon: React.ReactNode }[] = []
  if (canOverview) items.push({ id: 'overview', label: 'Overview', icon: <SlidersHorizontal size={16} /> })
  items.push({ id: 'roles', label: 'Roles', icon: <Shield size={16} /> })
  items.push({ id: 'members', label: 'Members', icon: <Users size={16} /> })
  if (canBans) items.push({ id: 'bans', label: 'Bans', icon: <Gavel size={16} /> })
  if (canOverview) items.push({ id: 'emoji', label: 'Emoji', icon: <Smile size={16} /> }, { id: 'stickers', label: 'Stickers', icon: <Sticker size={16} /> }, { id: 'discovery', label: 'Discovery', icon: <Compass size={16} /> })

  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} wide={tab !== 'overview'}
      sections={[{ title: guild.name, items }]}
      footer={isOwner ? (
        <div className="flex flex-col max-md:flex-row gap-0.5">
          <button onClick={() => openModal({ kind: 'transferOwnership', guildId })} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 hover:text-text-0 whitespace-nowrap" title="Transfer Ownership"><span className="max-md:hidden">Transfer Ownership</span><Crown size={16} /></button>
          <button onClick={del} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title="Delete Server"><span className="max-md:hidden">Delete Server</span><Trash2 size={16} /></button>
        </div>
      ) : undefined}
    >
      {tab === 'overview' && canOverview && <GuildOverviewTab guildId={guildId} />}
      {tab === 'roles' && <RolesTab guildId={guildId} />}
      {tab === 'members' && <MembersTab guildId={guildId} />}
      {tab === 'bans' && canBans && <BansTab guildId={guildId} />}
      {tab === 'emoji' && canOverview && <EmojiTab guildId={guildId} />}
      {tab === 'stickers' && canOverview && <StickersTab guildId={guildId} />}
      {tab === 'discovery' && canOverview && <DiscoveryTab guildId={guildId} />}
    </SettingsShell>
  )
}
