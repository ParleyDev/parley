import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import type { Member } from '../../lib/types'
import { useStore } from '../../store'

/** Change Nickname: yours (Change Nickname) or a member's (Manage Nicknames), only in this server. Empty resets it. */
export default function NicknameModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId: string }) {
  const me = useStore((s) => s.user)
  const member = useStore((s) => s.members[guildId]?.[userId])
  const user = useStore((s) => s.users[userId])
  const upsertMember = useStore((s) => s.upsertMember)
  const pushToast = useStore((s) => s.pushToast)
  const [nick, setNick] = useState(member?.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const self = me?.id === userId
  const name = user?.display_name ?? member?.display_name ?? 'this member'
  const save = async (value: string) => {
    setBusy(true)
    try {
      upsertMember(await api.patch<Member>(`/guilds/${guildId}/members/${userId}`, { nickname: value.trim() || null }))
      pushToast(value.trim() ? 'Nickname changed' : 'Nickname reset'); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Change Nickname" onClose={onClose} width="max-w-sm"
      footer={<>{member?.nickname && <button type="button" className="btn-ghost mr-auto" onClick={() => save('')} disabled={busy} data-nick-reset>Reset Nickname</button>}<button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={() => save(nick)} disabled={busy} data-nick-save>Save</button></>}>
      <label className="label" htmlFor="nick-input">{self ? 'Your nickname in this server' : `Nickname for ${name}`}</label>
      <input id="nick-input" className="input" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={name} autoFocus data-nick-input
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(nick) } }} />
      <p className="mt-2 text-xs text-text-2">Everyone in this server sees it instead of {self ? 'your' : 'their'} display name. Leave it empty to go back to the display name.</p>
    </Modal>
  )
}
