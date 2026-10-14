import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'

/** Confirm a ban with an optional reason (shown in the server's ban list). */
export default function BanMemberModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const member = useStore((s) => s.members[guildId]?.[userId])
  const user = useStore((s) => s.users[userId])
  const removeMember = useStore((s) => s.removeMember)
  const pushToast = useStore((s) => s.pushToast)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!guild) return null
  const name = member?.nickname ?? member?.display_name ?? user?.display_name ?? 'this user'

  const ban = async () => {
    setBusy(true)
    try {
      await api.put(`/guilds/${guildId}/bans/${userId}`, { reason: reason.trim() })
      removeMember(guildId, userId)
      pushToast(`${name} was banned`)
      onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={`Ban ${name}`} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={ban} disabled={busy}>Ban</button></>}>
      <p className="text-sm text-text-1">Are you sure you want to ban <b className="text-text-0">{name}</b> from {guild.name}? They will be removed and will not be able to rejoin until they are unbanned.</p>
      <label className="label mt-4">Reason for ban</label>
      <textarea className="input resize-none" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} placeholder="Optional — visible to moderators in the ban list" autoFocus />
    </Modal>
  )
}
