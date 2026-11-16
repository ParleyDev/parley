import type { HTMLAttributes } from 'react'
import { cropStyle } from '../lib/crop'
import { parseBanner, type BannerFormat } from '../lib/bannerFormat'

/** A header image drawn in a box of any size, laid out as its URL says (lib/bannerFormat). */
export function BannerPicture({ url, format }: { url: string; format?: BannerFormat }) {
  const f = format ?? parseBanner(url).format
  if (f.fit === 'fit') return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" data-banner-fit>
      <img src={url} alt="" draggable={false} className="h-full w-full max-w-none scale-110 object-cover blur-2xl brightness-75" />
      <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full max-w-none object-contain" style={{ objectPosition: `${f.x}% ${f.y}%` }} data-banner-img />
    </span>
  )
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" data-banner-fill>
      <img src={url} alt="" draggable={false} className="h-full w-full max-w-none object-cover" style={cropStyle(f)} data-banner-img />
    </span>
  )
}

/** A community's header: its image, or a wash of its colour without one. */
export default function CommunityBanner({ url, tint, className = '', children, ...rest }: { url: string | null | undefined; tint: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`relative isolate w-full overflow-hidden ${className}`} style={url ? undefined : { background: `linear-gradient(135deg, ${tint}, ${tint}55)` }} {...rest}>
      {url && <BannerPicture url={url} />}
      {children}
    </div>
  )
}
