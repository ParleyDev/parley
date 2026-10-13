import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Channel } from '../../lib/types'

export default function ChannelSettingsModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const channel = useStore((s) => s.channels[channelId])
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeChannel = useStore((s) => s.removeChannel)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const [name, setName] = useState(channel?.name ?? '')
  const [topic, setTopic] = useState(channel?.topic ?? '')
  const [busy, setBusy] = useState(false)
  if (!channel) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const c = await api.patch<Channel>(`/channels/${channelId}`, { name, topic }); upsertChannel(c); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const del = () => openModal({
    kind: 'confirm', title: 'Delete Channel', body: `Are you sure you want to delete #${channel.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Channel',
    action: async () => {
      try { await api.delete(`/channels/${channelId}`); removeChannel(channelId); navigate(`/channels/${channel.guild_id}`) } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })
  return (
    <Modal title="Channel Settings" onClose={onClose} footer={<><button className="btn-danger mr-auto" onClick={del}>Delete Channel</button><button className="btn-ghost" onClick={onClose}>Cancel</button><button form="channel-settings" className="btn-primary" disabled={busy || !name.trim()}>Save</button></>}>
      <form id="channel-settings" onSubmit={submit} className="space-y-4">
        <div><label className="label">Channel name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
        {channel.kind === 'text' && <div><label className="label">Channel topic</label><textarea className="input resize-none" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="Let everyone know how to use this channel!" /></div>}
      </form>
    </Modal>
  )
}
