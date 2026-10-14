import { Download, FileText } from 'lucide-react'
import { useStore } from '../store'
import type { Attachment } from '../lib/types'
import { formatBytes, isAudio, isImage, isVideo } from '../lib/upload'

const MAX_W = 400, MAX_H = 300

/** Renders a message's attachments: images inline (click for lightbox), video/audio players, file cards. */
export default function Attachments({ items }: { items: Attachment[] }) {
  const openModal = useStore((s) => s.openModal)
  if (!items.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {items.map((a) => {
        if (isImage(a.content_type)) {
          // Size the box from the known dimensions so the chat doesn't jump while loading.
          const w = a.width ?? MAX_W, h = a.height ?? MAX_H
          const scale = Math.min(1, MAX_W / w, MAX_H / h)
          return (
            <button key={a.id} onClick={() => openModal({ kind: 'image', url: a.url, name: a.filename })} className="block overflow-hidden rounded-lg bg-bg-0/40 border border-line hover:border-text-2 max-w-full" style={{ width: Math.round(w * scale), aspectRatio: `${w} / ${h}` }} title={a.filename}>
              <img src={a.url} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
            </button>
          )
        }
        if (isVideo(a.content_type)) {
          return <video key={a.id} src={a.url} controls preload="metadata" className="rounded-lg border border-line bg-black max-w-full" style={{ maxWidth: MAX_W, maxHeight: MAX_H }} />
        }
        if (isAudio(a.content_type)) {
          return (
            <div key={a.id} className="rounded-lg border border-line bg-bg-3 p-2 w-full max-w-[400px]">
              <div className="text-sm font-medium truncate mb-1">{a.filename}</div>
              <audio src={a.url} controls preload="metadata" className="w-full h-9" />
            </div>
          )
        }
        return (
          <a key={a.id} href={a.url} download={a.filename} className="flex items-center gap-3 rounded-lg border border-line bg-bg-3 px-3 py-2.5 w-full max-w-[400px] hover:bg-bg-4 group">
            <FileText size={28} className="text-text-2 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-sky-400 truncate group-hover:underline">{a.filename}</div>
              <div className="text-xs text-text-2">{formatBytes(a.size)}</div>
            </div>
            <Download size={18} className="text-text-2 group-hover:text-text-0 shrink-0" />
          </a>
        )
      })}
    </div>
  )
}
