import { Lock, SlidersHorizontal, Tag, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { myChannelPerms, useStore } from '../../store'
import type { Channel } from '../../lib/types'
import { has, P } from '../../lib/perms'
import SettingsShell from './SettingsShell'
import ChannelPermissionsTab from './settings/ChannelPermissionsTab'
import ForumTagsTab from './settings/ForumTagsTab'

type Tab = 'overview' | 'permissions' | 'tags'

export default function ChannelSettingsModal({ onClose, channelId, tab: initial = 'overview' }: { onClose: () => void; channelId: string; tab?: Tab }) {
  const channel = useStore((s) => s.channels[channelId])
  const perms = useStore((s) => myChannelPerms(s, channelId))
  const openModal = useStore((s) => s.openModal)
  const removeChannel = useStore((s) => s.removeChannel)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const canEdit = has(perms, P.MANAGE_CHANNELS)
  const canPerms = has(perms, P.MANAGE_ROLES)
  const [tab, setTab] = useState<Tab>(initial === 'overview' && !canEdit && canPerms ? 'permissions' : initial)
  if (!channel) return null
  const prefix = channel.kind === 'text' ? '#' : ''

  const del = () => openModal({
    kind: 'confirm', title: 'Delete Channel', body: `Are you sure you want to delete ${prefix}${channel.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Channel',
    action: async () => {
      try { await api.delete(`/channels/${channelId}`); removeChannel(channelId); onClose(); navigate(`/channels/${channel.guild_id}`) } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })

  const items: { id: Tab; label: string; icon: React.ReactNode }[] = []
  if (canEdit) items.push({ id: 'overview', label: 'Overview', icon: <SlidersHorizontal size={16} /> })
  if (canEdit && channel.kind === 'forum') items.push({ id: 'tags', label: 'Tags', icon: <Tag size={16} /> })
  if (canPerms) items.push({ id: 'permissions', label: 'Permissions', icon: <Lock size={16} /> })

  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} wide={tab === 'permissions'}
      sections={[{ title: `${prefix}${channel.name}`, items }]}
      footer={canEdit ? <button onClick={del} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title="Delete Channel"><span className="max-md:hidden">Delete Channel</span><Trash2 size={16} /></button> : undefined}
    >
      {tab === 'overview' && canEdit && <Overview channel={channel} />}
      {tab === 'tags' && canEdit && <ForumTagsTab channelId={channelId} />}
      {tab === 'permissions' && canPerms && <ChannelPermissionsTab channelId={channelId} />}
    </SettingsShell>
  )
}

function Overview({ channel }: { channel: Channel }) {
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic)
  const [busy, setBusy] = useState(false)
  const dirty = name !== channel.name || topic !== channel.topic
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const c = await api.patch<Channel>(`/channels/${channel.id}`, { name, topic }); upsertChannel(c); pushToast('Channel updated') } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-xl font-bold">Overview</h1>
      <div><label className="label">Channel name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      {channel.kind === 'text' && <div><label className="label">Channel topic</label><textarea className="input resize-none" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="Let everyone know how to use this channel!" /></div>}
      {dirty && (
        <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">Careful — you have unsaved changes!</span>
          <button type="button" className="btn-ghost" onClick={() => { setName(channel.name); setTopic(channel.topic) }}>Reset</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !name.trim()}>Save Changes</button>
        </div>
      )}
    </form>
  )
}
