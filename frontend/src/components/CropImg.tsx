import type { CSSProperties, ImgHTMLAttributes } from 'react'
import { cropStyle, splitCrop } from '../lib/crop'

/**
 * An <img> for profile pictures and server icons that honours their `#crop=` framing. Without one it is a plain <img>;
 * with one, the classes and style go on a clipping box and the picture inside is zoomed and positioned.
 */
export default function CropImg({ src, className = '', style, alt = '', ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const { crop } = splitCrop(src)
  if (!crop) return <img src={src} alt={alt} className={className} style={style} {...rest} />
  return (
    <span className={`${className} relative inline-block overflow-hidden`} style={style} data-cropped>
      <img src={src} alt={alt} {...rest} className="absolute inset-0 h-full w-full max-w-none object-cover" style={cropStyle(crop)} />
    </span>
  )
}

/**
 * The framed picture behind a banner or icon drawn as a CSS background: render it as the first child of a
 * `relative isolate` box and leave that box's background-image out (`bgUrl`). Draws nothing when there is no framing.
 */
export function CropLayer({ url, style }: { url: string | null | undefined; style?: CSSProperties }) {
  const { crop } = splitCrop(url)
  if (!url || !crop) return null
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" style={style} data-crop-layer>
      <img src={url} alt="" className="h-full w-full max-w-none object-cover" style={cropStyle(crop)} draggable={false} />
    </span>
  )
}
