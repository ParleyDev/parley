import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'

const REASONS = ['Spam or scam', 'Harassment or hate', 'Explicit or disturbing content', 'Illegal activity', 'Something else']

/** Report a message (with its author) or a user to the instance admins. */
export default function ReportModal({ onClose, messageId, userId, name }: { onClose: () => void; messageId?: string; userId: string; name: string }) {
  const pushToast = useStore((s) => s.pushToast)
  const [reason, setReason] = useState(REASONS[0])
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/reports', messageId ? { kind: 'message', message_id: messageId, reason: [reason, details.trim()].filter(Boolean).join(' — ') } : { kind: 'user', user_id: userId, reason: [reason, details.trim()].filter(Boolean).join(' — ') })
      pushToast('Thanks, your report was sent to the admins'); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={messageId ? 'Report Message' : `Report ${name}`} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={submit} disabled={busy} data-report-submit>Submit Report</button></>}>
      <div data-report-form>
        <p className="text-sm text-text-1">{messageId ? <>Report this message by <b className="text-text-0">{name}</b> to the admins of this Parley instance.</> : <>Report <b className="text-text-0">{name}</b> to the admins of this Parley instance.</>}</p>
        <label className="label mt-4">What's wrong?</label>
        <div className="space-y-1">
          {REASONS.map((r) => (
            <label key={r} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${reason === r ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`}>
              <input type="radio" name="report-reason" className="accent-accent" checked={reason === r} onChange={() => setReason(r)} data-report-reason={r} /> {r}
            </label>
          ))}
        </div>
        <label className="label mt-4">Anything else? <span className="normal-case font-normal text-text-2">(optional)</span></label>
        <textarea className="input resize-none" rows={3} maxLength={800} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Add context for the admins" data-report-details />
      </div>
    </Modal>
  )
}
