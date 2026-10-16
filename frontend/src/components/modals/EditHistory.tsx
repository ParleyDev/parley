import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { renderMarkdown } from '../../lib/markdown'

interface Revision { id: string; content: string; replaced_at: string }

/** "Show original": every previous version of an edited message, oldest first, then the current text. */
export default function EditHistoryModal({ onClose, channelId, messageId }: { onClose: () => void; channelId: string; messageId: string }) {
  const current = useStore((s) => s.messages[channelId]?.find((m) => m.id === messageId))
  const [revs, setRevs] = useState<Revision[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.get<Revision[]>(`/channels/${channelId}/messages/${messageId}/history`).then(setRevs).catch((e) => setErr((e as Error).message)) }, [channelId, messageId])
  const when = (iso: string) => new Date(iso).toLocaleString()
  return (
    <Modal title="Edit history" onClose={onClose} width="max-w-lg">
      <div className="space-y-3" data-edit-history>
        {err && <div className="text-sm text-danger">{err}</div>}
        {revs === null && !err && <div className="text-sm text-text-2">Loading…</div>}
        {revs?.map((r, i) => (
          <div key={r.id} className="rounded-lg border border-line bg-bg-0/50 p-3" data-revision={i}>
            <div className="text-[11px] uppercase tracking-wider text-text-2 mb-1">{i === 0 ? 'Original' : `Version ${i + 1}`} · replaced {when(r.replaced_at)}</div>
            <div className="msg-content text-[15px] leading-[1.375rem] whitespace-pre-wrap break-words">{renderMarkdown(r.content)}</div>
          </div>
        ))}
        {revs && current && (
          <div className="rounded-lg border border-accent/50 bg-accent/10 p-3" data-revision="current">
            <div className="text-[11px] uppercase tracking-wider text-text-2 mb-1">Current{current.edited_at ? ` · edited ${when(current.edited_at)}` : ''}</div>
            <div className="msg-content text-[15px] leading-[1.375rem] whitespace-pre-wrap break-words">{renderMarkdown(current.content)}</div>
          </div>
        )}
        {revs && revs.length === 0 && <div className="text-sm text-text-2">No earlier versions were kept for this message.</div>}
      </div>
    </Modal>
  )
}
