import { useState } from 'react'
import { SafetyContact } from '../../lib/policies'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { useT, tn } from '../../lib/i18n'

/** A reason the reporter picks. `id` goes into the report's text (and names the choice in tests); `category` is what the server sorts and routes by. */
interface Reason { id: string; label: string; category: string; sub?: Reason[] }
const CHILD: Reason[] = [
  { id: 'Sexual content involving a child', label: 'Sexual pictures, video or talk involving a child', category: 'child_sexual_content' },
  { id: 'An adult pursuing a child', label: 'An adult pursuing or pressuring a child', category: 'child_grooming' },
  { id: 'A child in an 18+ space', label: 'A child in an 18+ channel or conversation', category: 'minor_in_adult_space' },
  { id: 'Someone too young to be here', label: 'Someone too young to have an account', category: 'underage_user' },
]
const REASONS: Reason[] = [
  { id: 'Spam or scam', label: 'Spam or scam', category: 'spam' },
  { id: 'Harassment or hate', label: 'Harassment or hate', category: 'harassment' },
  { id: 'Explicit or disturbing content', label: 'Explicit or disturbing content', category: 'explicit' },
  { id: 'Threat of violence', label: 'Threat of violence', category: 'threat' },
  { id: 'Self-harm', label: 'Someone may hurt themselves', category: 'self_harm' },
  { id: 'Child safety', label: 'A child is at risk', category: 'child_sexual_content', sub: CHILD },
  { id: 'Intimate image without consent', label: 'Intimate pictures shared without consent', category: 'intimate_image' },
  { id: 'Illegal activity', label: 'Other illegal activity', category: 'illegal' },
  { id: 'Something else', label: 'Something else', category: 'other' },
]
/** Looked at first, and exempt from the limit on how many reports a person can send (mirrors the server). */
const URGENT = new Set(['child_sexual_content', 'child_grooming', 'minor_in_adult_space', 'intimate_image', 'threat', 'self_harm'])
/** Go to the instance's own team only: a server's moderators are never told (one of them may be who it is about). */
const INSTANCE_ONLY = new Set(['child_sexual_content', 'child_grooming', 'minor_in_adult_space', 'intimate_image'])

/** Report a message (with its author) or a user to the instance admins. */
export default function ReportModal({ onClose, messageId, userId, name, guildId, server }: { onClose: () => void; messageId?: string; userId: string; name: string; guildId?: string | null; server?: boolean }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [top, setTop] = useState<Reason>(REASONS[0])
  const [sub, setSub] = useState<Reason>(CHILD[0])
  const picked = top.sub ? sub : top
  const reason = picked.id, category = picked.category
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  // In a server, a message or member report can also go to that server's moderators.
  const [toMods, setToMods] = useState(true)
  const canMods = !!guildId && !server && !INSTANCE_ONLY.has(category)
  const submit = async () => {
    setBusy(true)
    try {
      const why = [reason, details.trim()].filter(Boolean).join(' — ')
      const mods = canMods && toMods
      await api.post('/reports', server ? { kind: 'guild', guild_id: guildId, reason: why, category } : messageId ? { kind: 'message', message_id: messageId, reason: why, category, to_mods: mods } : { kind: 'user', user_id: userId, guild_id: guildId ?? null, reason: why, category, to_mods: mods })
      pushToast(mods ? t("Thanks, your report was sent to the admins and this server's moderators") : t('Thanks, your report was sent to the admins')); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  // Shown right under the chosen reason, where it is read before anything else is filled in.
  const urgentNote = URGENT.has(category) && (
          <div className="mt-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-text-1" role="note" data-report-urgent={category}>
            <p className="font-semibold text-text-0">{t('Reports like this are looked at first.')}</p>
            {INSTANCE_ONLY.has(category) && <p className="mt-1" data-report-instance-only>{t("It goes only to the team that runs this Parley instance, never to a server's moderators.")}</p>}
            {category === 'child_sexual_content' && <p className="mt-1" data-report-no-copy>{t("Don't save, screenshot or forward it, even as proof. Reporting is enough: what you reported is kept for the people who have to deal with it.")}</p>}
            {(category === 'threat' || category === 'self_harm' || category === 'child_grooming') && <p className="mt-1" data-report-emergency>{t('If someone is in danger right now, call your local emergency number first.')}</p>}
          </div>
        )
  return (
    <Modal title={server ? t('Report {name}', { name }) : messageId ? t('Report Message') : t('Report {name}', { name })} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn-danger" onClick={submit} disabled={busy} data-report-submit>{t('Submit Report')}</button></>}>
      <div data-report-form>
        <SafetyContact className="mb-2" />
        <p className="text-sm text-text-1">{messageId ? <>{tn('Report this message by {name} to the admins of this Parley instance.', { name: <b className="text-text-0">{name}</b> })}</> : <>{tn('Report {name} to the admins of this Parley instance.', { name: <b className="text-text-0">{name}</b> })}</>}</p>
        <label className="label mt-4">{t("What's wrong?")}</label>
        <div className="space-y-1">
          {REASONS.map((r) => (
            <div key={r.id}>
              <label className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${top.id === r.id ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`}>
                <input type="radio" name="report-reason" className="accent-accent" checked={top.id === r.id} onChange={() => setTop(r)} data-report-reason={r.id} data-report-category={r.sub ? '' : r.category} /> {t(r.label)}
              </label>
              {r.sub && top.id === r.id && (
                <div className="mt-1 ml-4 space-y-1 border-l-2 border-line pl-2" data-report-sub>
                  {r.sub.map((c) => (
                    <label key={c.id} className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer ${sub.id === c.id ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`}>
                      <input type="radio" name="report-sub" className="accent-accent" checked={sub.id === c.id} onChange={() => setSub(c)} data-report-reason={c.id} data-report-category={c.category} /> {t(c.label)}
                    </label>
                  ))}
                </div>
              )}
              {top.id === r.id && urgentNote}
            </div>
          ))}
        </div>
        <label className="label mt-4">{t('Anything else?')} <span className="normal-case font-normal text-text-2">{t('(optional)')}</span></label>
        <textarea className="input resize-none" rows={3} maxLength={800} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('Add context for the admins')} data-report-details />
        {canMods && <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-accent" checked={toMods} onChange={(e) => setToMods(e.target.checked)} data-report-to-mods /> {t("Also tell this server's moderators")}</label>}
      </div>
    </Modal>
  )
}
