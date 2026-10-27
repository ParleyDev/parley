import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { useT, tn } from '../../lib/i18n'

const REASONS = [{ id: 'Spam or scam', label: 'Spam or scam' }, { id: 'Harassment or hate', label: 'Harassment or hate' }, { id: 'Explicit or disturbing content', label: 'Explicit or disturbing content' }, { id: 'Illegal activity', label: 'Illegal activity' }, { id: 'Something else', label: 'Something else' }]

/** Report a message (with its author) or a user to the instance admins. */
export default function ReportModal({ onClose, messageId, userId, name, guildId, server }: { onClose: () => void; messageId?: string; userId: string; name: string; guildId?: string | null; server?: boolean }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [reason, setReason] = useState(REASONS[0].id)
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  // In a server, a message or member report can also go to that server's moderators.
  const [toMods, setToMods] = useState(true)
  const canMods = !!guildId && !server
  const submit = async () => {
    setBusy(true)
    try {
      const why = [reason, details.trim()].filter(Boolean).join(' — ')
      const mods = canMods && toMods
      await api.post('/reports', server ? { kind: 'guild', guild_id: guildId, reason: why } : messageId ? { kind: 'message', message_id: messageId, reason: why, to_mods: mods } : { kind: 'user', user_id: userId, guild_id: guildId ?? null, reason: why, to_mods: mods })
      pushToast(mods ? t("Thanks, your report was sent to the admins and this server's moderators") : t('Thanks, your report was sent to the admins')); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={server ? t('Report {name}', { name }) : messageId ? t('Report Message') : t('Report {name}', { name })} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn-danger" onClick={submit} disabled={busy} data-report-submit>{t('Submit Report')}</button></>}>
      <div data-report-form>
        <p className="text-sm text-text-1">{messageId ? <>{tn('Report this message by {name} to the admins of this Parley instance.', { name: <b className="text-text-0">{name}</b> })}</> : <>{tn('Report {name} to the admins of this Parley instance.', { name: <b className="text-text-0">{name}</b> })}</>}</p>
        <label className="label mt-4">{t("What's wrong?")}</label>
        <div className="space-y-1">
          {REASONS.map(({ id: r, label }) => (
            <label key={r} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${reason === r ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`}>
              <input type="radio" name="report-reason" className="accent-accent" checked={reason === r} onChange={() => setReason(r)} data-report-reason={r} /> {t(label)}
            </label>
          ))}
        </div>
        <label className="label mt-4">{t('Anything else?')} <span className="normal-case font-normal text-text-2">{t('(optional)')}</span></label>
        <textarea className="input resize-none" rows={3} maxLength={800} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('Add context for the admins')} data-report-details />
        {canMods && <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-accent" checked={toMods} onChange={(e) => setToMods(e.target.checked)} data-report-to-mods /> {t("Also tell this server's moderators")}</label>}
      </div>
    </Modal>
  )
}
