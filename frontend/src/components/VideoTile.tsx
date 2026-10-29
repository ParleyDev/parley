import { fetchPreview } from '../lib/streamPreview'
import { Expand, Eye, EyeOff, Shrink } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from '../lib/brand'
import Avatar from './Avatar'
import { useT } from '../lib/i18n'

interface Props { stream: MediaStream | null; mirror?: boolean; className?: string; contain?: boolean }

/** Renders a MediaStream; muted so audio only ever plays through the per-peer <audio> element. */
export default function VideoTile({ stream, mirror, className = '', contain }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) el.play().catch(() => {})
    return () => { el.srcObject = null }
  }, [stream])
  return (
    <video ref={ref} autoPlay playsInline muted
      className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''} ${className}`} />
  )
}

// Fit vs fill: how a feed whose shape differs from its tile is shown. "fit" letterboxes so nothing is cropped
// (the default); "fill" crops to cover the tile. One preference for every tile, remembered across sessions.
export type VideoFit = 'fit' | 'fill'
const FIT_KEY = `${STORAGE_PREFIX}videoFit`
let fit: VideoFit = (() => { try { return localStorage.getItem(FIT_KEY) === 'fill' ? 'fill' : 'fit' } catch { return 'fit' } })()
const listeners = new Set<() => void>()
export function setVideoFit(v: VideoFit) { fit = v; try { localStorage.setItem(FIT_KEY, v) } catch { /* ignore */ } listeners.forEach((l) => l()) }
export function useVideoFit(): VideoFit {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => fit)
}

/** Hover button on a video tile that flips every tile between fit and fill. */
export function FitToggle({ className = '' }: { className?: string }) {
  const t = useT()
  const v = useVideoFit()
  const next: VideoFit = v === 'fit' ? 'fill' : 'fit'
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setVideoFit(next) }} onDoubleClick={(e) => e.stopPropagation()}
      title={v === 'fit' ? t('Fill the frame (crops the edges)') : t('Fit the whole feed in the frame')} aria-label={v === 'fit' ? t('Fill frame') : t('Fit frame')}
      className={`rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 hover:text-text-0 ${className}`} data-tile-fit={v}>
      {v === 'fit' ? <Expand size={14} /> : <Shrink size={14} />}
    </button>
  )
}

/**
 * A screen share you aren't watching yet: the streamer's avatar with Watch Stream, like Discord. Nothing is sent to you
 * until you click it (see voice.watch). `canWatch` is false while you aren't in the call.
 */
export function StreamGate({ user, big, canWatch, onWatch, channelId }: { user: { id: string; display_name: string; avatar_url: string | null } | undefined; big: boolean; canWatch: boolean; onWatch: () => void; channelId?: string }) {
  const t = useT()
  // A recent still of the stream (refreshed every 20 s) instead of just the avatar.
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!channelId || !user) return
    let alive = true, url: string | null = null
    const load = () => fetchPreview(channelId, user.id).then((u) => { if (!alive) { if (u) URL.revokeObjectURL(u); return } if (u) { if (url) URL.revokeObjectURL(url); url = u; setPreview(u) } })
    void load()
    const timer = setInterval(load, 20_000)
    return () => { alive = false; clearInterval(timer); if (url) URL.revokeObjectURL(url) }
  }, [channelId, user])
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-3 overflow-hidden bg-bg-1 p-3 text-center" data-stream-gate data-stream-preview={preview ? '1' : '0'}>
      {preview ? <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" aria-hidden />
        : user?.avatar_url && <img src={user.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 blur-2xl scale-110" aria-hidden />}
      <div className="relative flex flex-col items-center gap-2">
        {user && <Avatar user={user} size={big ? 72 : 40} />}
        <span className={`font-semibold text-text-0 ${big ? 'text-base' : 'text-xs'}`}>{t('{name} is streaming', { name: user?.display_name ?? t('Someone') })}</span>
        {canWatch
          ? <button type="button" onClick={(e) => { e.stopPropagation(); onWatch() }} className={`btn-primary ${big ? '' : 'px-3 py-1 text-xs'}`} data-watch-stream><Eye size={big ? 16 : 13} /> {t('Watch Stream')}</button>
          : <span className="text-xs text-text-2">{t('Join the call to watch')}</span>}
      </div>
    </div>
  )
}

/** Corner button on a screen share you're watching: stop receiving it. */
export function StopWatching({ onStop }: { onStop: () => void }) {
  const t = useT()
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onStop() }} title={t('Stop Watching')} aria-label={t('Stop Watching')} className="rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 phone:opacity-100 hover:text-text-0" data-stop-watching><EyeOff size={14} /></button>
  )
}
