import { Hash, Volume2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Channel } from '../../lib/types'

export default function CreateChannelModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'text' | 'voice'>('text')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const c = await api.post<Channel>(`/guilds/${guildId}/channels`, { name, kind })
      upsertChannel(c); onClose(); navigate(`/channels/${guildId}/${c.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Create Channel" onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button form="create-channel" className="btn-primary" disabled={busy || !name.trim()}>Create Channel</button></>}>
      <form id="create-channel" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Channel type</label>
          <div className="space-y-2">
            {([['text', 'Text', 'Send messages, images, GIFs, emoji, opinions, and puns', Hash], ['voice', 'Voice', 'Hang out together with voice, video, and screen share', Volume2]] as const).map(([v, t, d, Icon]) => (
              <button type="button" key={v} onClick={() => setKind(v)} className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${kind === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-3 hover:bg-bg-4'}`}>
                <Icon size={22} className="text-text-1" />
                <div><div className="font-semibold">{t}</div><div className="text-xs text-text-2">{d}</div></div>
                <span className={`ml-auto h-5 w-5 rounded-full border-2 ${kind === v ? 'border-accent bg-accent' : 'border-text-2'}`} />
              </button>
            ))}
          </div>
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div>
          <label className="label">Channel name</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2">{kind === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}</span>
            <input className="input pl-9" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="new-channel" maxLength={100} required />
          </div>
        </div>
      </form>
    </Modal>
  )
}
