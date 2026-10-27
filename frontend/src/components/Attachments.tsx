import { isPdf, isTextFile, PdfCard, TextPreview } from './FilePreview'
import { Download, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import VoiceMessage from './VoiceMessage'
import type { Attachment } from '../lib/types'
import { formatBytes, isAudio, isImage, isVideo } from '../lib/upload'
import { MEDIA_SIZES, usePrefs } from '../lib/prefs'
import FrozenGif from './FrozenGif'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { imageMenu } from '../lib/imageMenu'
import { isExplicit } from '../lib/explicit'
import { useT } from '../lib/i18n'


export const isSpoiler = (a: Pick<Attachment, 'filename'>) => a.filename.startsWith('SPOILER_')
export const displayName = (a: Pick<Attachment, 'filename'>) => a.filename.replace(/^SPOILER_/, '')

/** Renders a message's attachments: images inline (several in a mosaic; click opens a gallery of them), video/audio
 *  players, file cards. Spoilers stay blurred until clicked. */
/** Personal sensitive-media level for this message: blur everything (true), blur what looks explicit ('filter'). */
type Sens = boolean | 'filter'

export default function Attachments({ items, mine, sensitive, enforced }: { items: Attachment[]; mine?: boolean; sensitive?: Sens; enforced?: boolean }) {
  const prefs = usePrefs()
  if (!items.length) return null
  const pictures = prefs.inlineAttachments ? items.filter((a) => isImage(a.content_type)) : []
  const rest = items.filter((a) => !pictures.includes(a))
  return (
    <div className="mt-1 flex flex-col gap-2">
      {pictures.length > 1 ? <Mosaic items={pictures} sensitive={sensitive} enforced={enforced} /> : null}
      {(pictures.length === 1 || rest.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {(pictures.length === 1 ? [...pictures, ...rest] : rest).map((a) => <Spoilered key={a.id} a={a} sensitive={isImage(a.content_type) || isVideo(a.content_type) ? sensitive : false} enforced={enforced && (isImage(a.content_type) || isVideo(a.content_type))}><One a={{ ...a, filename: displayName(a) }} mine={mine} gallery={pictures} /></Spoilered>)}
        </div>
      )}
    </div>
  )
}

/** The gallery a click opens: every picture in the message, starting at the one clicked. */
const galleryOf = (pictures: Attachment[]) => pictures.map((p) => ({ url: p.url, name: displayName(p), alt: p.description ?? undefined }))

/** Two to ten pictures in a grid, Discord-style: 2 side by side, 3 as one big and two small, 4 as 2x2, more in rows of three. */
function Mosaic({ items, sensitive, enforced }: { items: Attachment[]; sensitive?: Sens; enforced?: boolean }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  const prefs = usePrefs()
  const { w: MAX_W } = MEDIA_SIZES[prefs.mediaSize]
  const menu = useContextMenu()
  const n = items.length
  const cols = n === 2 || n === 4 ? 'grid-cols-2' : n === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-3'
  return (
    <div className={`grid gap-1 overflow-hidden rounded-lg ${cols}`} style={{ width: MAX_W, maxWidth: '100%' }} data-mosaic={n}>
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label={t('Image')} />}
      {items.map((a, i) => (
        <div key={a.id} className={`relative ${n === 3 && i === 0 ? 'row-span-2' : ''} ${n === 3 && i === 0 ? 'h-full' : 'aspect-square'} min-h-0`}>
          <Spoilered a={a} sensitive={sensitive} enforced={enforced}>
            <button type="button" onClick={() => openModal({ kind: 'image', url: a.url, name: displayName(a), items: galleryOf(items), index: i })} onContextMenu={(e) => menu.open(e, imageMenu(a.url, displayName(a)))}
              className="block h-full w-full bg-bg-0/40 hover:brightness-110" title={a.description || displayName(a)} data-mosaic-item={i}>
              {a.content_type === 'image/gif' && !prefs.autoplayGifs
                ? <FrozenGif src={a.url} alt={a.description || displayName(a)} className="h-full w-full object-cover" data-attachment-img="gif" />
                : <img src={a.thumb_url ?? a.url} alt={a.description || displayName(a)} loading="lazy" className="h-full w-full object-cover" data-attachment-img={a.thumb_url ? 'thumb' : 'full'} />}
            </button>
          </Spoilered>
          {a.description && <AltBadge text={a.description} />}
        </div>
      ))}
    </div>
  )
}

/** "ALT" on a described picture: hover or focus shows the description. */
function AltBadge({ text }: { text: string }) {
  const t = useT()
  return <span tabIndex={0} title={text} aria-label={t('Alt text: {text}', { text })} className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1 text-[10px] font-bold text-white" data-alt-badge>{t('ALT')}</span>
}

/** Explicit check for one picture or video (on-device); 'pending' until it answers, null when it can't tell. */
function useExplicit(a: Attachment | null): boolean | null | 'pending' {
  const [v, setV] = useState<boolean | null | 'pending'>(a ? 'pending' : null)
  const url = a ? (isVideo(a.content_type) ? a.url : a.thumb_url ?? a.url) : null
  useEffect(() => {
    if (!a || !url) { setV(null); return }
    let live = true
    setV('pending')
    void isExplicit(url, isVideo(a.content_type) ? 'video' : 'image').then((r) => { if (live) setV(r) })
    return () => { live = false }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

/**
 * Spoilers, the sensitive-media preference, and explicit-image filters. `enforced`: the server's filter applies to
 * this author, so a picture found explicit stays hidden (no reveal); a personal 'filter' blurs it until clicked.
 */
function Spoilered({ a, children, sensitive, enforced }: { a: Attachment; children: React.ReactNode; sensitive?: Sens; enforced?: boolean }) {
  const t = useT()
  const [shown, setShown] = useState(false)
  const check = useExplicit((sensitive === 'filter' || enforced) && !isSpoiler(a) ? a : null)
  if (enforced && check === true) return <div className="flex h-24 w-64 max-w-full items-center justify-center rounded-lg border border-line bg-bg-1 px-3 text-center text-xs text-text-2" data-explicit-removed>{t("Explicit image hidden by this server's filter")}</div>
  if (shown) return <>{children}</>
  if (isSpoiler(a)) return <Blurred label="SPOILER" onShow={() => setShown(true)}>{children}</Blurred>
  if (check === 'pending') return <Blurred label="CHECKING" onShow={() => {}}>{children}</Blurred>
  if (sensitive === true) return <Blurred label="SENSITIVE" onShow={() => setShown(true)}>{children}</Blurred>
  if (sensitive === 'filter' && check === true) return <Blurred label="EXPLICIT" onShow={() => setShown(true)}>{children}</Blurred>
  return <>{children}</>
}

/** Blur-until-clicked overlay used for spoilers and for media the sensitive-media preference hides. */
export function Blurred({ label, onShow, children }: { label: 'SPOILER' | 'SENSITIVE' | 'EXPLICIT' | 'CHECKING'; onShow: () => void; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className={`relative overflow-hidden rounded-lg ${label === 'CHECKING' ? 'cursor-wait' : 'cursor-pointer'}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShow() }} data-spoiler-attachment data-blur={label.toLowerCase()}>
      <div className="pointer-events-none blur-xl brightness-50 select-none" aria-hidden>{children}</div>
      <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/70 px-3 py-1 text-xs font-extrabold tracking-wider text-white">{({ SPOILER: t('SPOILER'), SENSITIVE: t('SENSITIVE'), EXPLICIT: t('EXPLICIT'), CHECKING: t('CHECKING') })[label]}</span></span>
    </div>
  )
}

/** Wrap any media (an embed image, a linked picture) so it blurs until clicked when `on`. */
export function MaybeBlurred({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [shown, setShown] = useState(false)
  if (!on || shown) return <>{children}</>
  return <Blurred label="SENSITIVE" onShow={() => setShown(true)}>{children}</Blurred>
}

function One({ a, mine, gallery = [] }: { a: Attachment; mine?: boolean; gallery?: Attachment[] }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  const prefs = usePrefs()
  const { w: MAX_W, h: MAX_H } = MEDIA_SIZES[prefs.mediaSize]
  const inline = prefs.inlineAttachments
  const menu = useContextMenu()
  return (
    <>
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label={t('Image')} />}
      {[a].map((a) => {
        if (isImage(a.content_type) && inline) {
          // Size the box from the known dimensions so the chat doesn't jump while loading.
          const w = a.width ?? MAX_W, h = a.height ?? MAX_H
          const scale = Math.min(1, MAX_W / w, MAX_H / h)
          return (
            <span key={a.id} className="relative block max-w-full" style={{ width: Math.round(w * scale) }}>
              <button onClick={() => openModal({ kind: 'image', url: a.url, name: a.filename, items: galleryOf(gallery), index: Math.max(0, gallery.findIndex((g) => g.id === a.id)) })} onContextMenu={(e) => menu.open(e, imageMenu(a.url, a.filename))} className="block w-full overflow-hidden rounded-lg bg-bg-0/40 border border-line hover:border-text-2" style={{ aspectRatio: `${w} / ${h}` }} title={a.description || a.filename}>
                {a.content_type === 'image/gif' && !prefs.autoplayGifs
                  ? <FrozenGif src={a.url} alt={a.description || a.filename} className="h-full w-full object-cover" data-attachment-img="gif" />
                  : <img src={a.thumb_url ?? a.url} alt={a.description || a.filename} loading="lazy" className="h-full w-full object-cover" data-attachment-img={a.thumb_url ? 'thumb' : 'full'} />}
              </button>
              {a.description && <AltBadge text={a.description} />}
            </span>
          )
        }
        if (isVideo(a.content_type) && inline) {
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
        if (inline && isTextFile(a)) return <TextPreview key={a.id} a={a} />
        if (isPdf(a)) return <PdfCard key={a.id} a={a} />
        return (
          <a key={a.id} href={a.url} download={a.filename} className="flex items-center gap-3 rounded-lg border border-line bg-bg-3 px-3 py-2.5 w-full max-w-[400px] hover:bg-bg-4 group" data-attachment-card>
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
