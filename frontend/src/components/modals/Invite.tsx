import { Check, Copy, Search, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { DmChannel, Invite } from '../../lib/types'
import Avatar from '../Avatar'

export default function InviteModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const relationships = useStore((s) => s.relationships)
  const members = useStore((s) => s.members[guildId])
  const sendMessage = useStore((s) => s.sendMessage)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState<string | null>(null)
  const friends = Object.values(relationships).filter((r) => r.kind === 'friend').map((r) => r.user).filter((u) => !q || u.display_name.toLowerCase().includes(q.toLowerCase()) || u.username.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const [invite, setInvite] = useState<Invite | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    // Listing invites needs Manage Server; anyone with Create Invite can still mint a fresh one.
    api.get<Invite[]>(`/guilds/${guildId}/invites`).catch(() => [] as Invite[])
      .then((list) => list.find((i) => i.max_uses === null) ?? api.post<Invite>(`/guilds/${guildId}/invites`, {}))
      .then(setInvite).catch((e) => setErr((e as Error).message))
  }, [guildId])
  const link = invite ? `${location.origin}/invite/${invite.code}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }
  const sendTo = async (userId: string) => {
    if (!link) return
    setSending(userId)
    try {
      const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: userId })
      upsertChannel(c); await sendMessage(c.id, link); setSent((x) => ({ ...x, [userId]: true }))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setSending(null) }
  }
  return (
    <Modal title={`Invite friends to ${guild?.name ?? 'server'}`} onClose={onClose}>
      {err && <p className="text-sm text-danger mb-2">{err}</p>}
      <label className="label">Send a server invite link to a friend</label>
      <div className="flex items-center gap-2 rounded-lg bg-bg-0/60 border border-line p-1 pl-3">
        <input readOnly value={link || 'Generating…'} className="flex-1 bg-transparent text-sm outline-none" onFocus={(e) => e.target.select()} />
        <button onClick={copy} disabled={!link} className={`btn ${copied ? 'bg-success text-white' : 'bg-accent text-white hover:bg-accent-hover'} py-1.5`}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
      </div>
      <p className="mt-2 text-xs text-text-2">Your invite link never expires.</p>
      <div className="mt-5">
        <div className="relative">
          <input className="input pl-9" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} data-invite-friend-search />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-line rounded-lg border border-line" data-invite-friends>
          {friends.length === 0 && <p className="p-4 text-sm text-text-2">{q ? 'No friends match.' : 'Add some friends to invite them directly.'}</p>}
          {friends.map((u) => {
            const already = !!members?.[u.id]
            return (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2" data-invite-friend={u.id}>
                <Avatar user={u} size={32} />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{u.display_name}</div><div className="truncate text-xs text-text-2">@{u.username}</div></div>
                {already ? <span className="text-xs text-text-2">Already a member</span>
                  : sent[u.id] ? <span className="flex items-center gap-1 text-xs text-success"><Check size={14} /> Sent</span>
                  : <button type="button" className="btn-primary py-1 text-xs" disabled={!link || sending === u.id} onClick={() => sendTo(u.id)} data-invite-send><Send size={13} /> Invite</button>}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
