import { useEffect, useRef, useState } from 'react'

/**
 * An animated image shown as its first frame until hovered (or clicked); used when GIF autoplay, animated
 * emoji or sticker animation is off. Falls back to the live image if the frame cannot be drawn.
 */
export default function FrozenGif({ src, alt, className, title, mode = 'hover', ...rest }: { src: string; alt?: string; className?: string; title?: string; mode?: 'hover' | 'never' } & Record<`data-${string}`, string | undefined>) {
  const [playing, setPlaying] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (playing) return
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src
    img.onload = () => { const c = canvas.current; if (!c) return; c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1; try { c.getContext('2d')?.drawImage(img, 0, 0) } catch { setFailed(true) } }
    img.onerror = () => setFailed(true)
  }, [src, playing])
  if (playing || failed) return <img src={src} alt={alt} title={title} className={className} draggable={false} onMouseLeave={() => mode === 'hover' && setPlaying(false)} {...rest} />
  return <canvas ref={canvas} role="img" aria-label={alt} title={title ? `${title} (paused)` : 'Paused'} className={className} data-frozen="1" onMouseEnter={() => mode === 'hover' && setPlaying(true)} onClick={() => setPlaying(true)} {...rest} />
}
