import { FileText, PlusCircle, SendHorizontal, Smile, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { myChannelPerms, useStore } from '../store'
import { sendTyping } from '../lib/ws'
import type { Attachment, Channel, DmChannel, Message } from '../lib/types'
import { has, P } from '../lib/perms'
import { formatBytes, isImage, MAX_PER_MESSAGE, uploadFile, type UploadHandle } from '../lib/upload'

const QUICK_EMOJI = ['😀', '😂', '😍', '🔥', '👍', '🎉', '😢', '🤔', '👀', '❤️', '🚀', '✨', '💯', '🙏', '😎', '🥳']

interface Props { channel: Channel | DmChannel; reply: Message | null; onCancelReply: () => void; onSent: () => void }

interface Pending { key: number; file: File; preview: string | null; progress: number; done: Attachment | null; error: string | null; handle: UploadHandle | null }

let pendingSeq = 1

export default function Composer({ channel, reply, onCancelReply, onSent }: Props) {
  const sendMessage = useStore((s) => s.sendMessage)
  const pushToast = useStore((s) => s.pushToast)
  const typing = useStore((s) => s.typing[channel.id])
  const users = useStore((s) => s.users)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const canSend = has(perms, P.SEND_MESSAGES)
  const canAttach = canSend && (channel.guild_id === null || has(perms, P.ATTACH_FILES))
  const [value, setValue] = useState('')
  const [emoji, setEmoji] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTyping = useRef(0)
  const isDm = channel.guild_id === null
  const name = isDm ? `@${(channel as DmChannel).recipients[0]?.display_name ?? ''}` : (channel as Channel).kind === 'voice' ? channel.name : `#${channel.name}`

  useEffect(() => { ref.current?.focus() }, [channel.id, reply])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 300) + 'px'
  }, [value])
  // Switching channels drops the draft attachments (and cancels in-flight uploads).
  useEffect(() => () => { setPending((ps) => { ps.forEach((p) => { p.handle?.abort(); if (p.preview) URL.revokeObjectURL(p.preview) }); return [] }) }, [channel.id])

  const addFiles = (files: FileList | File[]) => {
    if (!canAttach) { pushToast('You do not have permission to attach files here', 'error'); return }
    const list = Array.from(files)
    if (!list.length) return
    setPending((ps) => {
      const room = MAX_PER_MESSAGE - ps.length
      if (list.length > room) pushToast(`You can attach up to ${MAX_PER_MESSAGE} files per message`, 'error')
      const next = list.slice(0, Math.max(0, room)).map((file): Pending => {
        const key = pendingSeq++
        const preview = isImage(file.type) ? URL.createObjectURL(file) : null
        const p: Pending = { key, file, preview, progress: 0, done: null, error: null, handle: null }
        p.handle = uploadFile(channel.id, file, (f) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, progress: f } : x))))
        p.handle.promise
          .then((att) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, done: att, progress: 1 } : x))))
          .catch((e: Error) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, error: e.message } : x))))
        return p
      })
      return [...ps, ...next]
    })
    ref.current?.focus()
  }
  const removePending = (key: number) => setPending((ps) => {
    const p = ps.find((x) => x.key === key)
    if (p) { p.handle?.abort(); if (p.preview) URL.revokeObjectURL(p.preview) }
    return ps.filter((x) => x.key !== key)
  })

  // Drag and drop anywhere on the page targets the open composer.
  useEffect(() => {
    if (!canAttach) return
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setDragging(true) }
    const onLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false) }
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const onDrop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; setDragging(false); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files) }
    window.addEventListener('dragenter', onEnter); window.addEventListener('dragleave', onLeave); window.addEventListener('dragover', onOver); window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAttach, channel.id])

  const uploading = pending.some((p) => !p.done && !p.error)
  const ready = pending.filter((p) => p.done)
  const canSubmit = (value.trim().length > 0 || ready.length > 0) && !uploading && !sending

  const submit = async () => {
    if (!canSubmit) return
    const content = value.trim()
    const ids = ready.map((p) => p.done!.id)
    const snapshot = pending
    setValue(''); setPending([]); onCancelReply(); setSending(true)
    try {
      await sendMessage(channel.id, content, reply?.id, ids)
      snapshot.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview) })
      onSent()
    } catch (e) {
      pushToast((e as Error).message, 'error'); setValue(content); setPending(snapshot)
    } finally { setSending(false) }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    if (e.key === 'Escape' && reply) onCancelReply()
  }
  const onChange = (v: string) => {
    setValue(v)
    const now = Date.now()
    if (v && now - lastTyping.current > 4000) { lastTyping.current = now; sendTyping(channel.id) }
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length) { e.preventDefault(); addFiles(files) }
  }

  const typers = Object.keys(typing ?? {}).map((id) => users[id]?.display_name ?? 'Someone')

  if (!canSend) {
    return (
      <div className="shrink-0 px-4 pb-6 pt-1 max-md:px-2 max-md:pb-2">
        <div className="rounded-xl bg-bg-3/60 border border-line px-4 py-3 text-[15px] text-text-2">You do not have permission to send messages in this channel.</div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="shrink-0 px-4 pb-6 pt-1 max-md:px-2 max-md:pb-2 relative">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/20 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-bg-1/90 px-10 py-8 text-center pop">
            <div className="text-xl font-bold">Upload to {name}</div>
            <div className="text-sm text-text-2 mt-1">Drop files to attach them to your message</div>
          </div>
        </div>
      )}
      <div className="rounded-xl bg-bg-3 border border-line focus-within:border-accent/50 transition">
        {reply && (
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-text-1 border-b border-line bg-bg-4/40 rounded-t-xl">
            <span>Replying to <b className="text-text-0">{reply.author.display_name}</b></span>
            <button onClick={onCancelReply} className="text-text-2 hover:text-text-0"><X size={14} /></button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex gap-3 overflow-x-auto px-3 pt-3 pb-1 border-b border-line">
            {pending.map((p) => (
              <div key={p.key} className={`relative w-40 shrink-0 rounded-lg border bg-bg-2 p-2 ${p.error ? 'border-danger' : 'border-line'}`} data-pending>
                <button onClick={() => removePending(p.key)} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-bg-1 border border-line text-text-2 hover:text-danger flex items-center justify-center" title="Remove"><X size={12} /></button>
                <div className="h-24 flex items-center justify-center overflow-hidden rounded bg-bg-0/40">
                  {p.preview ? <img src={p.preview} alt="" className="h-full w-full object-contain" /> : <FileText size={36} className="text-text-2" />}
                </div>
                <div className="mt-1.5 text-xs truncate" title={p.file.name}>{p.file.name}</div>
                <div className="text-[10px] text-text-2">{p.error ? <span className="text-danger">{p.error}</span> : p.done ? formatBytes(p.file.size) : `Uploading… ${Math.round(p.progress * 100)}%`}</div>
                {!p.done && !p.error && <div className="mt-1 h-1 rounded bg-bg-4 overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 px-3 py-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
          <button className={`pb-1 ${canAttach ? 'text-text-2 hover:text-text-0' : 'text-text-2/40 cursor-not-allowed'}`} title={canAttach ? 'Upload a file' : 'No permission to attach files'} onClick={() => canAttach && fileRef.current?.click()}><PlusCircle size={22} /></button>
          <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} onPaste={onPaste} placeholder={`Message ${name}`}
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-text-2 max-h-[300px]" maxLength={2000} />
          <div className="relative pb-1">
            <button className="text-text-2 hover:text-warn" onClick={() => setEmoji((e) => !e)} title="Emoji"><Smile size={22} /></button>
            {emoji && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setEmoji(false)} />
                <div className="pop absolute bottom-full right-0 mb-3 z-40 grid grid-cols-[repeat(8,2rem)] gap-1 rounded-xl bg-bg-0 border border-line p-2 shadow-2xl">
                  {QUICK_EMOJI.map((e) => <button key={e} onClick={() => { setValue((v) => v + e); setEmoji(false); ref.current?.focus() }} className="h-8 w-8 rounded-md text-xl hover:bg-bg-3">{e}</button>)}
                </div>
              </>
            )}
          </div>
          <button onClick={submit} disabled={!canSubmit} className="text-accent disabled:text-text-2 pb-1 hover:text-accent-hover" title="Send"><SendHorizontal size={22} /></button>
        </div>
      </div>
      <div className="h-5 px-1 pt-1 text-xs text-text-1 flex items-center gap-1.5">
        {typers.length > 0 && (
          <>
            <span className="flex gap-0.5"><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /></span>
            <span><b>{typers.slice(0, 3).join(', ')}</b> {typers.length > 3 ? 'and others are' : typers.length === 1 ? 'is' : 'are'} typing…</span>
          </>
        )}
      </div>
    </div>
  )
}
