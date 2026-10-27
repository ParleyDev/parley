import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { useStore } from '../../store'
import Modal from '../Modal'
import { useT } from '../../lib/i18n'

interface Mine { status: 'pending' | 'approved' | 'rejected'; created_at: string }

/** Apply to join a server that reviews new members: its rules, its questions, then wait for a moderator. */
export default function ApplicationModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [mine, setMine] = useState<Mine | null | undefined>(undefined)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Mine | null>(`/guilds/${guildId}/application`).then(setMine).catch(() => setMine(null)) }, [guildId])
  if (!guild || mine === undefined) return null
  const qs = guild.applications?.questions ?? []
  const missing = qs.some((q) => q.required && !(answers[q.id ?? ''] ?? '').trim()) || (!!guild.rules && !agree)
  const submit = async () => {
    setBusy(true)
    try {
      setMine(await api.post<Mine>(`/guilds/${guildId}/application`, { answers: qs.map((q) => ({ question_id: q.id, answer: answers[q.id ?? ''] ?? '' })) }))
      pushToast(t('Application sent'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const pending = mine?.status === 'pending'
  return (
    <Modal title={t('Apply to join {name}', { name: guild.name })} onClose={onClose} width="max-w-lg"
      footer={pending ? <button type="button" className="btn-primary" onClick={onClose}>{t('Close')}</button> : <><button type="button" className="btn-ghost" onClick={onClose}>{t('Not now')}</button><button type="button" className="btn-primary" disabled={busy || missing} onClick={submit} data-apply-submit>{t('Submit')}</button></>}>
      {pending ? (
        <div className="py-4 text-center" data-apply-pending>
          <div className="text-4xl">⏳</div>
          <p className="mt-2 font-semibold">{t('Your application is being reviewed')}</p>
          <p className="mt-1 text-sm text-text-2">{t('The moderators of {name} will look at it soon. You can read along until then.', { name: guild.name })}</p>
        </div>
      ) : (
        <div className="space-y-4" data-apply-form>
          {guild.rules && (
            <div>
              <div className="label">{t('Server rules')}</div>
              <div className="msg-content max-h-40 overflow-y-auto rounded-lg border border-line bg-bg-1 p-3 text-sm text-text-1">{renderMarkdown(guild.rules)}</div>
              <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-apply-agree />{t("I've read and agree to the rules")}</label>
            </div>
          )}
          {qs.map((q, i) => (
            <div key={q.id ?? i}>
              <label className="label" htmlFor={`apply-${i}`}>{q.title}{q.required && <span className="text-danger"> *</span>}</label>
              {q.paragraph
                ? <textarea id={`apply-${i}`} className="input resize-none" rows={3} maxLength={1000} value={answers[q.id ?? ''] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id ?? '']: e.target.value })} data-apply-answer={i} />
                : <input id={`apply-${i}`} className="input" maxLength={150} value={answers[q.id ?? ''] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id ?? '']: e.target.value })} data-apply-answer={i} />}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
