import { useEffect, useRef } from 'react'

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
