import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import ImagePicker from './ImagePicker'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Channel, Guild } from '../../lib/types'

export default function CreateGuildModal({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [name, setName] = useState(user ? `${user.display_name}'s server` : '')
  const [icon, setIcon] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>('/guilds', { name, icon_url: icon })
      upsertGuild(g)
      onClose()
      navigate(`/channels/${g.id}/${g.channels.find((c) => c.kind === 'text')?.id ?? ''}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Customize your server" subtitle="Give your new server a personality with a name and an icon. You can always change it later." onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Back</button><button form="create-guild" className="btn-primary" disabled={busy || !name.trim()}>Create</button></>}>
      <form id="create-guild" onSubmit={submit} className="space-y-4">
        <ImagePicker value={icon} onChange={setIcon} label={name} id={name || 'x'} />
        {err && <p className="text-sm text-danger">{err}</p>}
        <div><label className="label">Server name</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      </form>
    </Modal>
  )
}
