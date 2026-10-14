import { Check, Crown, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Guild } from '../../lib/types'

/** Owner-only: hand the server to another member. Irreversible from the old owner's side. */
export default function TransferOwnershipModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId?: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const me = useStore((s) => s.user)
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const loadMembers = useStore((s) => s.loadMembers)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(userId ?? null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!loaded) loadMembers(guildId) }, [guildId, loaded, loadMembers])
  if (!guild || !me) return null

  const list = Object.values(members ?? {})
    .filter((m) => m.user_id !== me.id)
    .filter((m) => !q || m.display_name.toLowerCase().includes(q.toLowerCase()) || m.username.toLowerCase().includes(q.toLowerCase()) || (m.nickname ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))
  const target = selected ? members?.[selected] : undefined

  const transfer = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const g = await api.post<Guild>(`/guilds/${guildId}/owner`, { user_id: selected })
      upsertGuild(g)
      pushToast(`${target?.nickname ?? target?.display_name ?? 'They'} now own${target ? 's' : ''} ${guild.name}`)
      onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title="Transfer Ownership" subtitle={`Choose the new owner of ${guild.name}. You will keep your roles but lose owner powers.`} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={transfer} disabled={busy || !selected || !ack}><Crown size={16} /> Transfer Ownership</button></>}>
      <div className="relative mb-2">
        <input className="input pl-9" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-line bg-bg-0/40 p-1 space-y-0.5">
        {!loaded && <p className="p-3 text-sm text-text-2">Loading members…</p>}
        {loaded && list.length === 0 && <p className="p-3 text-sm text-text-2">No other members to transfer to.</p>}
        {list.map((m) => (
          <button key={m.user_id} type="button" onClick={() => setSelected(m.user_id)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${selected === m.user_id ? 'bg-accent/20 text-text-0' : 'hover:bg-bg-3 text-text-1'}`}>
            <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={28} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{m.nickname ?? m.display_name}</span><span className="block truncate text-xs text-text-2">@{m.username}</span></span>
            {selected === m.user_id && <Check size={16} className="text-accent shrink-0" />}
          </button>
        ))}
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm text-text-1 cursor-pointer">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-accent" />
        <span>I understand that transferring ownership gives <b className="text-text-0">{target ? (target.nickname ?? target.display_name) : 'the new owner'}</b> full control of this server, including the ability to delete it, and that only they can give it back.</span>
      </label>
    </Modal>
  )
}
