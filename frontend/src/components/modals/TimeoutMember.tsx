import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Member } from '../../lib/types'

export const TIMEOUT_OPTIONS: [string, number][] = [['60 seconds', 1], ['5 minutes', 5], ['10 minutes', 10], ['1 hour', 60], ['1 day', 24 * 60], ['1 week', 7 * 24 * 60]]

/** Pick how long a member is timed out for (read-only in this server until it lapses). */
export default function TimeoutMemberModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const member = useStore((s) => s.members[guildId]?.[userId])
  const upsertMember = useStore((s) => s.upsertMember)
  const pushToast = useStore((s) => s.pushToast)
  const [minutes, setMinutes] = useState(10)
  const [busy, setBusy] = useState(false)
  if (!guild) return null
  const name = member?.nickname ?? member?.display_name ?? 'this member'

  const apply = async () => {
    setBusy(true)
    try {
      const m = await api.put<Member>(`/guilds/${guildId}/members/${userId}/timeout`, { minutes })
      upsertMember(m)
      pushToast(`${name} was timed out for ${TIMEOUT_OPTIONS.find(([, v]) => v === minutes)?.[0] ?? `${minutes} minutes`}`)
      onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={`Time out ${name}`} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={apply} disabled={busy} data-timeout-submit>Time Out</button></>}>
      <p className="text-sm text-text-1">While timed out, <b className="text-text-0">{name}</b> can read {guild.name} but cannot send messages, react, attach files or join voice. Moderators can lift it early.</p>
      <div className="mt-4 grid grid-cols-2 gap-2" data-timeout-options>
        {TIMEOUT_OPTIONS.map(([label, v]) => (
          <button key={v} type="button" onClick={() => setMinutes(v)} className={`rounded-md border px-3 py-2 text-sm text-left ${minutes === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-timeout-option={v}>{label}</button>
        ))}
      </div>
    </Modal>
  )
}
