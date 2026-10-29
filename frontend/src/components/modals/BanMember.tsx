import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { t, useT, tn } from '../../lib/i18n'

/** How much of a banned member's recent history to delete with them (Discord's choices). */
const historyOptions = (): { label: string; seconds: number }[] => [
  { label: t("Don't delete any"), seconds: 0 }, { label: t('Previous hour'), seconds: 3600 }, { label: t('Previous 6 hours'), seconds: 6 * 3600 },
  { label: t('Previous 12 hours'), seconds: 12 * 3600 }, { label: t('Previous 24 hours'), seconds: 86400 }, { label: t('Previous 3 days'), seconds: 3 * 86400 },
  { label: t('Previous 7 days'), seconds: 7 * 86400 },
]

/** Confirm a ban or kick with an optional reason (in the ban list and the audit log); a ban can also delete recent messages. */
export default function BanMemberModal({ onClose, guildId, userId, kick }: { onClose: () => void; guildId: string; userId: string; kick?: boolean }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const member = useStore((s) => s.members[guildId]?.[userId])
  const user = useStore((s) => s.users[userId])
  const removeMember = useStore((s) => s.removeMember)
  const pushToast = useStore((s) => s.pushToast)
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState(0)
  const [busy, setBusy] = useState(false)
  if (!guild) return null
  const name = member?.nickname || member?.display_name || user?.display_name || t('this user')

  const go = async () => {
    setBusy(true)
    try {
      if (kick) await api.delete(`/guilds/${guildId}/members/${userId}`, { reason: reason.trim() })
      else await api.put(`/guilds/${guildId}/bans/${userId}`, { reason: reason.trim(), delete_message_seconds: history })
      removeMember(guildId, userId)
      pushToast(kick ? t('{name} was kicked', { name }) : t('{name} was banned', { name }))
      onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={kick ? t('Kick {name}', { name }) : t('Ban {name}', { name })} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn-danger" onClick={go} disabled={busy} data-mod-confirm>{kick ? t('Kick') : t('Ban')}</button></>}>
      <p className="text-sm text-text-1">{kick
        ? <>{tn('Are you sure you want to kick {name} from {guild}? They can rejoin with a new invite.', { name: <b className="text-text-0">{name}</b>, guild: guild.name })}</>
        : <>{tn('Are you sure you want to ban {name} from {guild}? They will be removed and will not be able to rejoin until they are unbanned.', { name: <b className="text-text-0">{name}</b>, guild: guild.name })}</>}</p>
      {!kick && (
        <>
          <label className="label mt-4" htmlFor="ban-history">{t('Delete message history')}</label>
          <select id="ban-history" className="input" value={history} onChange={(e) => setHistory(Number(e.target.value))} data-ban-history>
            {historyOptions().map((h) => <option key={h.seconds} value={h.seconds}>{h.label}</option>)}
          </select>
        </>
      )}
      <label className="label mt-4" htmlFor="mod-reason">{kick ? t('Reason for kick') : t('Reason for ban')}</label>
      <textarea id="mod-reason" className="input resize-none" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} placeholder={kick ? t('Optional, shown in the audit log') : t('Optional, visible to moderators in the ban list')} autoFocus data-mod-reason />
    </Modal>
  )
}
