import { Download, FileText } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'
import VoiceMessage from './VoiceMessage'
import type { Attachment } from '../lib/types'
import { formatBytes, isAudio, isImage, isVideo } from '../lib/upload'

const MAX_W = 400, MAX_H = 300

export const isSpoiler = (a: Pick<Attachment, 'filename'>) => a.filename.startsWith('SPOILER_')
export const displayName = (a: Pick<Attachment, 'filename'>) => a.filename.replace(/^SPOILER_/, '')

/** Renders a message's attachments: images inline (click for lightbox), video/audio players, file cards. Spoilers stay blurred until clicked. */
export default function Attachments({ items, mine }: { items: Attachment[]; mine?: boolean }) {
  if (!items.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {items.map((a) => <Spoilered key={a.id} a={a}><One a={{ ...a, filename: displayName(a) }} mine={mine} /></Spoilered>)}
    </div>
  )
}

function Spoilered({ a, children }: { a: Attachment; children: React.ReactNode }) {
  const [shown, setShown] = useState(false)
  if (!isSpoiler(a) || shown) return <>{children}</>
  return (
    <div className="relative overflow-hidden rounded-lg cursor-pointer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShown(true) }} data-spoiler-attachment>
      <div className="pointer-events-none blur-xl brightness-50 select-none" aria-hidden>{children}</div>
      <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/70 px-3 py-1 text-xs font-extrabold tracking-wider text-white">SPOILER</span></span>
    </div>
  )
}

function One({ a, mine }: { a: Attachment; mine?: boolean }) {
  const openModal = useStore((s) => s.openModal)
  return (
    <>
      {[a].map((a) => {
        if (isImage(a.content_type)) {
          // Size the box from the known dimensions so the chat doesn't jump while loading.
          const w = a.width ?? MAX_W, h = a.height ?? MAX_H
          const scale = Math.min(1, MAX_W / w, MAX_H / h)
          return (
            <button key={a.id} onClick={() => openModal({ kind: 'image', url: a.url, name: a.filename })} className="block overflow-hidden rounded-lg bg-bg-0/40 border border-line hover:border-text-2 max-w-full" style={{ width: Math.round(w * scale), aspectRatio: `${w} / ${h}` }} title={a.filename}>
              <img src={a.thumb_url ?? a.url} alt={a.filename} loading="lazy" className="h-full w-full object-cover" data-attachment-img={a.thumb_url ? 'thumb' : 'full'} />
            </button>
          )
        }
        if (isVideo(a.content_type)) {
          return <video key={a.id} src={a.url} controls preload="metadata" className="rounded-lg border border-line bg-black max-w-full" style={{ maxWidth: MAX_W, maxHeight: MAX_H }} />
        }
        if (isAudio(a.content_type) && a.duration_ms) {
          return <VoiceMessage key={a.id} a={a} mine={!!mine} />
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
    </>
  )
}
