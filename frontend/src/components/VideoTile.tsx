import { Expand, Shrink } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from '../lib/brand'

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
  const v = useVideoFit()
  const next: VideoFit = v === 'fit' ? 'fill' : 'fit'
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setVideoFit(next) }} onDoubleClick={(e) => e.stopPropagation()}
      title={v === 'fit' ? 'Fill the frame (crops the edges)' : 'Fit the whole feed in the frame'} aria-label={v === 'fit' ? 'Fill frame' : 'Fit frame'}
      className={`rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 hover:text-text-0 ${className}`} data-tile-fit={v}>
      {v === 'fit' ? <Expand size={14} /> : <Shrink size={14} />}
    </button>
  )
}
