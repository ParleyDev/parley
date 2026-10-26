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
  const [priv, setPriv] = useState(false)
  const [archiveAfter, setArchiveAfter] = useState(4320)
  const parentKind = useStore((s) => s.channels[channelId]?.kind)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const t = await api.post<ThreadInfo>(`/channels/${channelId}/threads`, { name, message_id: messageId, private: priv, auto_archive_minutes: archiveAfter })
      upsertThread(t); useStore.getState().setMyThread(t.id, true); setOpenThread(t.id); onClose()
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Create Thread" onClose={onClose} width="max-w-sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="create-thread" className="btn-primary" disabled={busy || !name.trim()} data-thread-submit>Create Thread</button></>}>
      <form id="create-thread" onSubmit={submit}>
        <label className="label">Thread name</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="New Thread" data-thread-name />
        <label className="label mt-3" htmlFor="thread-archive">Hide after inactivity</label>
        <select id="thread-archive" className="input" value={archiveAfter} onChange={(e) => setArchiveAfter(Number(e.target.value))} data-thread-archive-after>
          {[[60, '1 hour'], [1440, '24 hours'], [4320, '3 days'], [10080, '1 week']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {!messageId && parentKind === 'text' && <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={priv} onChange={(e) => setPriv(e.target.checked)} data-thread-private /><span><span className="font-semibold">Private Thread</span><span className="block text-xs text-text-2">Only people you add (and moderators) can see it.</span></span></label>}
        <p className="mt-2 text-xs text-text-2">{messageId ? 'The thread starts from that message and appears as a card under it.' : 'Threads keep side conversations out of the main channel; everyone who can read the channel can join.'}</p>
      </form>
    </Modal>
  )
}
