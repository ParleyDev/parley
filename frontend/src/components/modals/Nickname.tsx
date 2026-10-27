import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import type { Member } from '../../lib/types'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

/** Change Nickname: yours (Change Nickname) or a member's (Manage Nicknames), only in this server. Empty resets it. */
export default function NicknameModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId: string }) {
  const t = useT()
  const me = useStore((s) => s.user)
  const member = useStore((s) => s.members[guildId]?.[userId])
  const user = useStore((s) => s.users[userId])
  const upsertMember = useStore((s) => s.upsertMember)
  const pushToast = useStore((s) => s.pushToast)
  const [nick, setNick] = useState(member?.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const self = me?.id === userId
  const name = user?.display_name ?? member?.display_name ?? t('this member')
  const save = async (value: string) => {
    setBusy(true)
    try {
      upsertMember(await api.patch<Member>(`/guilds/${guildId}/members/${userId}`, { nickname: value.trim() || null }))
      pushToast(value.trim() ? t('Nickname changed') : t('Nickname reset')); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={t('Change Nickname')} onClose={onClose} width="max-w-sm"
      footer={<>{member?.nickname && <button type="button" className="btn-ghost mr-auto" onClick={() => save('')} disabled={busy} data-nick-reset>{t('Reset Nickname')}</button>}<button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={() => save(nick)} disabled={busy} data-nick-save>{t('Save')}</button></>}>
      <label className="label" htmlFor="nick-input">{self ? t('Your nickname in this server') : t('Nickname for {name}', { name })}</label>
      <input id="nick-input" className="input" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={name} autoFocus data-nick-input
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(nick) } }} />
      <p className="mt-2 text-xs text-text-2">{self ? t('Everyone in this server sees it instead of your display name. Leave it empty to go back to the display name.') : t('Everyone in this server sees it instead of their display name. Leave it empty to go back to the display name.')}</p>
    </Modal>
  )
}
