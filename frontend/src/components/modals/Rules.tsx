import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import type { Member } from '../../lib/types'
import { useStore } from '../../store'

/** Membership screening: the server's rules with an "I agree" button that unlocks chatting. */
export default function RulesModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const me = useStore((s) => s.user)
  const member = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const upsertMember = useStore((s) => s.upsertMember)
  const pushToast = useStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  const accepted = !!member?.rules_accepted_at
  const agree = async () => {
    setBusy(true)
    try { const m = await api.post<Member>(`/guilds/${guildId}/rules/accept`, {}); upsertMember(m); pushToast(`Welcome to ${guild?.name ?? 'the server'}!`); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={`${guild?.name ?? 'Server'} rules`} onClose={onClose} width="max-w-lg"
      footer={<><button className="btn-ghost" onClick={onClose}>{accepted ? 'Close' : 'Not now'}</button>{!accepted && <button className="btn-primary" onClick={agree} disabled={busy} autoFocus data-rules-agree>{busy ? 'Saving…' : 'I agree'}</button>}</>}>
      <div className="msg-content text-sm text-text-1 max-h-[55vh] overflow-y-auto" data-rules-text>{guild?.rules ? renderMarkdown(guild.rules) : <p className="text-text-2">This server has no rules written down yet.</p>}</div>
      {!accepted && guild?.rules_required && <p className="mt-3 text-xs text-text-2">You need to accept these rules before you can send messages here.</p>}
    </Modal>
  )
}
