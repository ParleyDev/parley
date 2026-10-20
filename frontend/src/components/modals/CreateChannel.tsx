import { FolderOpen, Hash, Lock, MessageSquareText, Volume2, Radio } from 'lucide-react'
import { P } from '../../lib/perms'
import { Toggle } from './SettingsShell'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Channel } from '../../lib/types'

export default function CreateChannelModal({ onClose, guildId, parentId = null }: { onClose: () => void; guildId: string; parentId?: string | null }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'text' | 'voice' | 'stage' | 'category' | 'forum'>('text')
  const [parent, setParent] = useState<string>(parentId ?? '')
  const allChannels = useStore((s) => s.channels)
  const categories = Object.values(allChannels).filter((c) => c.guild_id === guildId && c.kind === 'category').sort((a, b) => a.position - b.position)
  const [isPrivate, setPrivate] = useState(false)
  const me = useStore((s) => s.user)
  const guild = useStore((s) => s.guilds[guildId])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const c = await api.post<Channel>(`/guilds/${guildId}/channels`, { name, kind, parent_id: kind === 'category' || !parent ? null : parent })
      if (isPrivate) {
        await api.put(`/channels/${c.id}/permissions/${guildId}`, { kind: 'role', allow: 0, deny: P.VIEW_CHANNEL })
        if (me && guild?.owner_id !== me.id) await api.put(`/channels/${c.id}/permissions/${me.id}`, { kind: 'member', allow: P.VIEW_CHANNEL, deny: 0 })
      }
      upsertChannel(c); onClose(); if (kind !== 'category') navigate(`/channels/${guildId}/${c.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Create Channel" onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button form="create-channel" className="btn-primary" disabled={busy || !name.trim()}>Create Channel</button></>}>
      <form id="create-channel" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Channel type</label>
          <div className="space-y-2">
            {([['text', 'Text', 'Send messages, images, GIFs, emoji, opinions, and puns', Hash], ['voice', 'Voice', 'Hang out together with voice, video, and screen share', Volume2], ['stage', 'Stage', 'Speakers on stage, everyone else listens and can raise a hand', Radio], ['forum', 'Forum', 'Organised posts with tags instead of a running chat', MessageSquareText], ['category', 'Category', 'Group channels under a collapsible heading', FolderOpen]] as const).map(([v, t, d, Icon]) => (
              <button type="button" key={v} onClick={() => setKind(v)} data-channel-kind={v} className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${kind === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-3 hover:bg-bg-4'}`}>
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
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2">{kind === 'text' || kind === 'forum' ? <Hash size={16} /> : kind === 'voice' ? <Volume2 size={16} /> : <FolderOpen size={16} />}</span>
            <input className="input pl-9" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'category' ? 'New Category' : 'new-channel'} maxLength={100} required data-channel-name />
          </div>
        </div>
        {kind !== 'category' && categories.length > 0 && (
          <div>
            <label className="label">Category</label>
            <select className="input" value={parent} onChange={(e) => setParent(e.target.value)} data-channel-parent>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="rounded-lg border border-line bg-bg-3 p-3">
          <Toggle label={kind === 'category' ? 'Private category' : 'Private channel'} checked={isPrivate} onChange={setPrivate} />
          <p className="text-xs text-text-2 mt-1 flex items-center gap-1"><Lock size={12} /> Only you and roles you add in channel permissions will see it.</p>
        </div>
      </form>
    </Modal>
  )
}
