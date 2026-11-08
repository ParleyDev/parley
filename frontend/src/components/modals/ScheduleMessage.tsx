import { CalendarClock, Check, Hash, MessageSquare, Paperclip } from 'lucide-react'
import { useMemo, useState } from 'react'
import Modal from '../Modal'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { schedulePresets, whenLabel } from '../../lib/scheduled'
import { dmName, isGroup } from '../../lib/dm'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * Schedule Message, like Discord's: the message (editable), a few presets (in an hour, tomorrow morning...) or a
 * custom day and time, then Schedule. Also edits a scheduled message from the Inbox (text and time).
 */
export default function ScheduleMessageModal({ onClose, channelId, content: initial, sendAt, files = 0, editing, action }: {
  onClose: () => void
  channelId: string
  content: string
  sendAt?: string
  files?: number
  editing?: boolean
  action: (content: string, sendAt: Date) => Promise<void>
}) {
  const t = useT()
  const channel = useStore((s) => s.channels[channelId])
  const dm = useStore((s) => s.dms[channelId])
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const pushToast = useStore((s) => s.pushToast)
  const [content, setContent] = useState(initial)
  const presets = useMemo(() => schedulePresets(), [])
  const start = sendAt ? new Date(sendAt) : null
  const [pick, setPick] = useState<string | null>(start ? 'custom' : null)
  const fallback = start ?? new Date(Date.now() + 3600_000)
  const [day, setDay] = useState(dateValue(fallback))
  const [time, setTime] = useState(timeValue(fallback))
  const [busy, setBusy] = useState(false)
  const at = pick === 'custom' ? new Date(`${day}T${time}`) : presets.find((p) => p.id === pick)?.at ?? null
  const valid = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 30_000
  const where = channel ? <><Hash size={14} />{channel.name}</> : dm ? <><MessageSquare size={14} />{isGroup(dm) ? dmName(dm, users, notes) : `@${dm.recipients[0]?.display_name ?? ''}`}</> : null
  const ok = valid && (content.trim().length > 0 || files > 0) && content.length <= 2000
  const submit = async () => {
    if (!ok || !at) return
    setBusy(true)
    try { await action(content.trim(), at); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const row = 'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] hover:bg-bg-3'
  return (
    <Modal title={editing ? t('Edit Scheduled Message') : t('Schedule Message')} onClose={onClose} layer="z-[60]"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={submit} disabled={!ok || busy} data-schedule-confirm>{editing ? t('Save') : t('Schedule')}</button></>}>
      <div data-schedule-dialog>
        {where && <div className="mb-2 flex items-center gap-1 text-sm text-text-2">{t('To')} <span className="flex items-center gap-1 font-semibold text-text-1">{where}</span></div>}
        <textarea className="input w-full resize-none text-[15px]" rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('Write your message')} maxLength={4000} data-schedule-text />
        {files > 0 && <div className="mt-1 flex items-center gap-1 text-xs text-text-2"><Paperclip size={12} />{t('{n} attachments go with it', { n: files })}</div>}
        {content.length > 2000 && <div className="mt-1 text-xs text-danger">{t('{n} characters over the {max} limit', { n: content.length - 2000, max: 2000 })}</div>}
        <div className="mt-4 mb-1 text-xs font-bold uppercase tracking-wide text-text-2">{t('Send')}</div>
        <div className="-mx-1 space-y-0.5" role="radiogroup">
          {presets.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} onClick={() => setPick(p.id)} className={`${row} ${pick === p.id ? 'bg-bg-3 text-text-0' : 'text-text-1'}`} data-schedule-preset={p.id}>
              <span>{p.label}</span>
              <span className="flex items-center gap-2 text-sm text-text-2">{whenLabel(p.at)}{pick === p.id && <Check size={16} className="text-accent" />}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={pick === 'custom'} onClick={() => setPick('custom')} className={`${row} ${pick === 'custom' ? 'bg-bg-3 text-text-0' : 'text-text-1'}`} data-schedule-preset="custom">
            <span className="flex items-center gap-2"><CalendarClock size={16} />{t('Custom')}</span>
            {pick === 'custom' && <Check size={16} className="text-accent" />}
          </button>
        </div>
        {pick === 'custom' && (
          <div className="mt-2 flex gap-2" data-schedule-custom>
            <input type="date" className="input min-w-0 flex-1" value={day} min={dateValue(new Date())} onChange={(e) => setDay(e.target.value)} aria-label={t('Day')} data-schedule-date />
            <input type="time" className="input w-32" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('Time')} data-schedule-time />
          </div>
        )}
        <p className={`mt-3 text-sm ${at && !valid ? 'text-danger' : 'text-text-2'}`} data-schedule-summary>
          {!at ? t('Pick when to send it.') : !valid ? t('Pick a time in the future.') : t('Sends {when}', { when: whenLabel(at) })}
        </p>
      </div>
    </Modal>
  )
}
