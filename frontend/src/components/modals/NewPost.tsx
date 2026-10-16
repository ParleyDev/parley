import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { ForumTag, ThreadInfo } from '../../lib/types'

/** Start a forum post: title, body and tags. The body becomes the post's first message. */
export default function NewPostModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const pushToast = useStore((s) => s.pushToast)
  const upsertThread = useStore((s) => s.upsertThread)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<ForumTag[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<ForumTag[]>(`/channels/${channelId}/tags`).then(setTags).catch(() => setTags([])) }, [channelId])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const t = await api.post<ThreadInfo>(`/channels/${channelId}/threads`, { name: title, content, tags: picked })
      upsertThread(t); setOpenThread(t.id); onClose()
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="New Post" onClose={onClose} width="max-w-lg"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="new-post" className="btn-primary" disabled={busy || !title.trim() || !content.trim()} data-post-submit>Post</button></>}>
      <form id="new-post" onSubmit={submit} className="space-y-4" data-new-post>
        <div><label className="label">Title</label><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required placeholder="What is this post about?" data-post-title /></div>
        <div><label className="label">Message</label><textarea className="input resize-none" rows={5} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} required placeholder="Say more…" data-post-content /></div>
        {tags.length > 0 && (
          <div>
            <label className="label">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => <button key={t.id} type="button" onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${picked.includes(t.id) ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-post-tag={t.id} aria-pressed={picked.includes(t.id)}>{t.emoji} {t.name}</button>)}
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
