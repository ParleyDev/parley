import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Attachment, ForumTag, ThreadInfo } from '../../lib/types'
import { isImage, isVideo, MAX_PER_MESSAGE, uploadFile } from '../../lib/upload'
import { ImagePlus, X } from 'lucide-react'
import { useT } from '../../lib/i18n'

/** Start a forum post: title, body, files and tags. The body becomes the post's first message. Media channels need an
 * image or video. */
export default function NewPostModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const upsertThread = useStore((s) => s.upsertThread)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<ForumTag[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(0)
  useEffect(() => { api.get<ForumTag[]>(`/channels/${channelId}/tags`).then(setTags).catch(() => setTags([])) }, [channelId])
  const forum = useStore((s) => s.channels[channelId])
  const needTag = !!forum?.forum_require_tag && tags.length > 0
  const media = !!forum?.media
  const hasMedia = files.some((f) => isImage(f.content_type) || isVideo(f.content_type))
  const add = (list: FileList | null) => {
    for (const f of [...(list ?? [])].slice(0, MAX_PER_MESSAGE - files.length)) {
      setUploading((n) => n + 1)
      uploadFile(channelId, f, () => {}).promise.then((a) => setFiles((x) => [...x, a])).catch((e: Error) => pushToast(e.message, 'error')).finally(() => setUploading((n) => n - 1))
    }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const th = await api.post<ThreadInfo>(`/channels/${channelId}/threads`, { name: title, content, tags: picked, attachment_ids: files.map((f) => f.id) })
      upsertThread(th); setOpenThread(th.id); onClose()
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={t('New Post')} onClose={onClose} width="max-w-lg"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button form="new-post" className="btn-primary" disabled={busy || uploading > 0 || !title.trim() || (!content.trim() && !files.length) || (media && !hasMedia) || (needTag && picked.length === 0)} data-post-submit>{t('Post')}</button></>}>
      <form id="new-post" onSubmit={submit} className="space-y-4" data-new-post>
        {forum?.topic && <p className="rounded-lg bg-bg-3 px-3 py-2 text-xs text-text-1 whitespace-pre-wrap" data-post-guidelines>{forum.topic}</p>}
        <div><label className="label">{t('Title')}</label><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required placeholder={t('What is this post about?')} data-post-title /></div>
        <div><label className="label">{t('Message')}</label><textarea className="input resize-none" rows={media ? 3 : 5} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} required={!media} placeholder={t('Say more…')} data-post-content /></div>
        <div>
          <label className="label">{media ? <>{t('Image or video')} <span className="normal-case font-normal text-text-2">{t('(required)')}</span></> : t('Files')}</label>
          <div className="flex flex-wrap gap-2" data-post-files>
            {files.map((f) => (
              <span key={f.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-bg-3" data-post-file={f.filename}>
                {isImage(f.content_type) ? <img src={f.url} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-text-2 break-all">{f.filename}</span>}
                <button type="button" onClick={() => setFiles(files.filter((x) => x.id !== f.id))} className="absolute right-0.5 top-0.5 rounded-full bg-bg-0/80 p-0.5" title={t('Remove')}><X size={12} /></button>
              </span>
            ))}
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line text-text-2 hover:bg-bg-3" title={t('Add files')}>
              {uploading ? '…' : <ImagePlus size={22} />}
              <input type="file" multiple accept={media ? 'image/*,video/*' : undefined} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} data-post-upload />
            </label>
          </div>
        </div>
        {tags.length > 0 && (
          <div>
            <label className="label">{t('Tags')}{needTag && <span className="ml-1 normal-case font-normal text-danger" data-post-tag-required>{t('(pick at least one)')}</span>}</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tg) => <button key={tg.id} type="button" onClick={() => setPicked((p) => (p.includes(tg.id) ? p.filter((x) => x !== tg.id) : [...p, tg.id]))} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${picked.includes(tg.id) ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-post-tag={tg.id} aria-pressed={picked.includes(tg.id)}>{tg.emoji} {tg.name}</button>)}
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
