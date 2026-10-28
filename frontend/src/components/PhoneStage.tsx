import { Maximize2, Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lib/i18n'
import { voice } from '../lib/voice'
import { useStore } from '../store'
import { HangUpButton } from './CallControls'

/**
 * Phones: one call tile, screen share or Activity across the whole screen. Browsers on iPhone can't make a page
 * element fullscreen and a double-click isn't a phone gesture, so a tap opens this instead. Tapping it shows or hides
 * its controls (close, mute, hang up), which also fade after a few seconds. Where the browser allows (Android), it
 * also goes truly fullscreen, and `landscape` turns a screen share sideways. Escape and the Android back button close it.
 */
export default function PhoneStage({ title, onClose, landscape = false, children }: { title: string; onClose: () => void; landscape?: boolean; children: ReactNode }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [chrome, setChrome] = useState(true)
  const muted = useStore((s) => s.selfMute || s.selfDeaf)
  const inCall = useStore((s) => !!s.myVoiceChannelId)
  useEffect(() => { if (!chrome) return; const id = setTimeout(() => setChrome(false), 3500); return () => clearTimeout(id) }, [chrome])
  useEffect(() => {
    const el = ref.current
    type Orientation = { lock?: (o: string) => Promise<void>; unlock?: () => void }
    const orientation = (screen as unknown as { orientation?: Orientation }).orientation
    el?.requestFullscreen?.().then(() => { if (landscape) void orientation?.lock?.('landscape')?.catch(() => {}) }).catch(() => {})
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      try { orientation?.unlock?.() } catch { /* not locked */ }
    }
  }, [landscape])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const back = (e: Event) => { e.preventDefault(); onClose() }
    window.addEventListener('keydown', key)
    window.addEventListener('parley:back', back)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('parley:back', back) }
  }, [onClose])
  const fade = `transition-opacity duration-200 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
  return createPortal(
    <div ref={ref} className="fixed inset-0 z-[150] bg-black flex" onClick={() => setChrome((c) => !c)} data-phone-stage>
      <div className="flex-1 min-w-0 min-h-0 p-[max(0px,var(--sat))_var(--sar)_var(--sab)_var(--sal)] [&_[data-voice-tile]]:rounded-none [&_[data-voice-tile]]:border-0 [&_[data-call-tile]]:rounded-none [&_[data-call-tile]]:border-0">{children}</div>
      <div className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-[max(12px,var(--sat))] ${fade}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} title={t('Close')} aria-label={t('Close')} className="h-10 w-10 shrink-0 rounded-full bg-white/15 text-white flex items-center justify-center" data-phone-stage-close><X size={20} /></button>
        <span className="truncate font-semibold text-white">{title}</span>
      </div>
      {inCall && (
        <div className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-[max(16px,var(--sab))] ${fade}`} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => voice.setMute(!muted)} title={muted ? t('Unmute') : t('Mute')} aria-label={muted ? t('Unmute') : t('Mute')} aria-pressed={muted} className={`h-12 w-12 rounded-full flex items-center justify-center ${muted ? 'bg-danger/80 text-white' : 'bg-white/15 text-white'}`} data-phone-stage-mute>{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
          <HangUpButton label={t('Disconnect')} onClick={() => { onClose(); voice.leave() }} data-phone-stage-leave="" />
        </div>
      )}
    </div>,
    document.body,
  )
}

/** The button over an Activity or a focused tile on phones that opens it across the screen. */
export function ExpandButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} title={t('Fullscreen')} aria-label={t('Fullscreen')} className="absolute right-2 top-2 z-20 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center md:hidden" data-phone-expand>
      <Maximize2 size={18} />
    </button>
  )
}
