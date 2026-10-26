import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { useStore } from '../../store'

const DURATIONS: [string, number | null][] = [['1 hour', 1], ['4 hours', 4], ['8 hours', 8], ['24 hours', 24], ['3 days', 72], ['1 week', 168], ['No end time', null]]

/** Compose a poll: question, 2–10 answers, multi-select, duration. Sent as a message with `poll`. */
export default function CreatePollModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const sendPoll = useStore((s) => s.sendPoll)
  const pushToast = useStore((s) => s.pushToast)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [emojis, setEmojis] = useState<string[]>(['', ''])
  const [multi, setMulti] = useState(false)
  const [duration, setDuration] = useState<number | null>(24)
  const [busy, setBusy] = useState(false)
  const filled = options.map((o) => o.trim()).filter(Boolean)
  // One emoji per kept answer (blank answers are dropped along with their emoji).
  const filledEmojis = options.map((o, i) => (o.trim() ? emojis[i]?.trim() || null : undefined)).filter((e): e is string | null => e !== undefined)
  const valid = question.trim().length > 0 && filled.length >= 2
  const submit = async () => {
    setBusy(true)
    try { await sendPoll(channelId, { question: question.trim(), options: filled, emojis: filledEmojis, multi, duration_hours: duration }); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Create Poll" onClose={onClose} width="max-w-md"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit} disabled={busy || !valid} data-poll-submit>Post Poll</button></>}>
      <div className="space-y-4" data-create-poll>
        <div><label className="label">Question</label><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="What should we play tonight?" autoFocus data-poll-q /></div>
        <div>
          <label className="label">Answers <span className="normal-case font-normal text-text-2">(2–10)</span></label>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input className="input w-12 shrink-0 px-0 text-center text-lg" value={emojis[i] ?? ''} onChange={(e) => setEmojis(options.map((_, j) => (j === i ? e.target.value : emojis[j] ?? '')))} maxLength={64} placeholder="🙂" title="Emoji (optional)" aria-label={`Emoji for answer ${i + 1}`} data-poll-emoji={i} />
                <input className="input" value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} maxLength={100} placeholder={`Answer ${i + 1}`} data-poll-opt={i} />
                {options.length > 2 && <button type="button" className="text-text-2 hover:text-danger" onClick={() => { setOptions(options.filter((_, j) => j !== i)); setEmojis(emojis.filter((_, j) => j !== i)) }} title="Remove"><X size={16} /></button>}
              </div>
            ))}
          </div>
          {options.length < 10 && <button type="button" className="mt-2 flex items-center gap-1 text-sm text-sky-400 hover:underline" onClick={() => { setOptions([...options, '']); setEmojis([...emojis, '']) }} data-poll-add><Plus size={14} /> Add answer</button>}
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" checked={multi} onChange={(e) => setMulti(e.target.checked)} data-poll-multi /> Allow multiple answers</label>
          <label className="flex items-center gap-2 text-sm">Duration
            <select className="input w-auto py-1" value={duration ?? ''} onChange={(e) => setDuration(e.target.value === '' ? null : Number(e.target.value))} data-poll-duration>
              {DURATIONS.map(([l, v]) => <option key={l} value={v ?? ''}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  )
}
