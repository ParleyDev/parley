import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Invite } from '../../lib/types'

export default function InviteModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
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
  return (
    <Modal title={`Invite friends to ${guild?.name ?? 'server'}`} onClose={onClose}>
      {err && <p className="text-sm text-danger mb-2">{err}</p>}
      <label className="label">Send a server invite link to a friend</label>
      <div className="flex items-center gap-2 rounded-lg bg-bg-0/60 border border-line p-1 pl-3">
        <input readOnly value={link || 'Generating…'} className="flex-1 bg-transparent text-sm outline-none" onFocus={(e) => e.target.select()} />
        <button onClick={copy} disabled={!link} className={`btn ${copied ? 'bg-success text-white' : 'bg-accent text-white hover:bg-accent-hover'} py-1.5`}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
      </div>
      <p className="mt-2 text-xs text-text-2">Your invite link never expires.</p>
    </Modal>
  )
}
