import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import ImagePicker from './ImagePicker'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Guild } from '../../lib/types'

export default function GuildSettingsModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [name, setName] = useState(guild?.name ?? '')
  const [icon, setIcon] = useState<string | null>(guild?.icon_url ?? null)
  const [busy, setBusy] = useState(false)
  if (!guild) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const g = await api.patch<Guild>(`/guilds/${guildId}`, { name, icon_url: icon ?? '' })
      upsertGuild(g); pushToast('Server updated'); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Server Overview" onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button form="guild-settings" className="btn-primary" disabled={busy || !name.trim()}>Save Changes</button></>}>
      <form id="guild-settings" onSubmit={submit} className="space-y-4">
        <ImagePicker value={icon} onChange={setIcon} label={name} id={guildId} />
        <div><label className="label">Server name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      </form>
    </Modal>
  )
}
