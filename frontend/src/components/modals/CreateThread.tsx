import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { ThreadInfo } from '../../lib/types'

/** Name a new thread; started from a message (card under it) or from the channel's Threads panel. */
export default function CreateThreadModal({ onClose, channelId, messageId, suggested = '' }: { onClose: () => void; channelId: string; messageId?: string; suggested?: string }) {
  const pushToast = useStore((s) => s.pushToast)
  const upsertThread = useStore((s) => s.upsertThread)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const [name, setName] = useState(suggested.slice(0, 100))
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const t = await api.post<ThreadInfo>(`/channels/${channelId}/threads`, { name, message_id: messageId })
      upsertThread(t); setOpenThread(t.id); onClose()
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Create Thread" onClose={onClose} width="max-w-sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="create-thread" className="btn-primary" disabled={busy || !name.trim()} data-thread-submit>Create Thread</button></>}>
      <form id="create-thread" onSubmit={submit}>
        <label className="label">Thread name</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="New Thread" data-thread-name />
        <p className="mt-2 text-xs text-text-2">{messageId ? 'The thread starts from that message and appears as a card under it.' : 'Threads keep side conversations out of the main channel; everyone who can read the channel can join.'}</p>
      </form>
    </Modal>
  )
}
