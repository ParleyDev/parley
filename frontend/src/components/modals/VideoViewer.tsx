import { Download, ExternalLink, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import ContextMenu, { useContextMenu } from '../ContextMenu'
import { absoluteUrl } from '../../lib/imageMenu'
import { fileMenu, saveFile } from '../../lib/fileActions'
import { pause as pauseAudio } from '../../lib/player'
import { usePhone } from '../../lib/swipe'
import { useT } from '../../lib/i18n'

/**
 * Videos play here, filling the screen, rather than in a small box in the chat: black backdrop, the video as large as
 * it fits, the browser's controls (including true full screen), download and open. Phones get the whole screen and the
 * Save / Share sheet. Escape or ✕ closes; audio from the app-wide player pauses while it plays.
 */
export default function VideoViewer({ onClose, url, name, at = 0 }: { onClose: () => void; url: string; name: string; at?: number }) {
  const t = useT()
  const phone = usePhone()
  const video = useRef<HTMLVideoElement>(null)
  const menu = useContextMenu()
  const dl = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-context-menu]') && !document.fullscreenElement) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (at) v.currentTime = at
    pauseAudio()
    v.play().catch(() => { /* autoplay with sound refused: the controls are there */ })
  }, [at])
  const items = fileMenu(url, name)
  const btn = 'h-10 w-10 rounded-full bg-black/50 flex items-center justify-center text-white/85 hover:bg-black/70 hover:text-white'
  return (
    <div className={`fixed inset-0 z-50 bg-black/95 flex items-center justify-center pop ${phone ? '' : 'safe-pad'}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal aria-label={name} data-video-viewer>
      <video ref={video} src={url} controls playsInline autoPlay preload="auto" onPlay={pauseAudio} onContextMenu={(e) => menu.open(e, items)}
        className={phone ? 'max-h-full w-full object-contain' : 'max-h-[86vh] max-w-[94vw] min-w-[min(640px,94vw)] rounded-lg bg-black shadow-2xl'} data-video-viewer-video />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-4 pt-[max(12px,env(safe-area-inset-top))] pb-6">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90" data-video-viewer-name>{name}</span>
        <button ref={dl} type="button" onClick={() => { const r = dl.current?.getBoundingClientRect(); if (phone && r) menu.open({ clientX: r.left, clientY: r.bottom }, items); else void saveFile(url, name) }} className={btn} title={t('Download')} aria-label={t('Download')} data-video-viewer-download><Download size={19} /></button>
        {!phone && <a href={absoluteUrl(url)} target="_blank" rel="noreferrer" className={btn} title={t('Open original')} aria-label={t('Open original')}><ExternalLink size={18} /></a>}
        <button type="button" onClick={onClose} className={btn} title={t('Close')} aria-label={t('Close')} data-video-viewer-close><X size={22} /></button>
      </div>
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label={t('Video')} />}
    </div>
  )
}
