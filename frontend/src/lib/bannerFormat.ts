import { create } from 'zustand'
import { splitCrop } from './crop'

/*
 * How a community's header image is laid out. The header is as wide as the window, so the same picture is shown from a
 * phone (about 2.4:1) to a wide monitor (8:1 and more):
 *  - fill: the picture covers the header, zoomed by z, and x/y (percent) say which part stays in view when the sides
 *    or the top and bottom are cut off. Stored as `#crop=z,x,y`, the same as every other framed picture, so anything
 *    that draws a plain framed banner still shows it right.
 *  - fit: the whole picture is shown, placed at x/y (0 = left/top, 50 = centre, 100 = right/bottom), over a blurred
 *    copy of itself that fills the rest. Stored as `#fit=x,y`.
 */
export type BannerFit = 'fill' | 'fit'
export interface BannerFormat { fit: BannerFit; z: number; x: number; y: number }

export const DEFAULT_BANNER: BannerFormat = { fit: 'fill', z: 1, x: 50, y: 50 }
const FIT_RE = /#fit=([\d.]+),([\d.]+)$/
const clampPct = (n: number) => Math.min(100, Math.max(0, n))
const round1 = (n: number) => Math.round(n * 10) / 10

/** The picture's URL without any layout, and its layout. */
export function parseBanner(url: string | null | undefined): { base: string; format: BannerFormat } {
  if (!url) return { base: '', format: DEFAULT_BANNER }
  const m = FIT_RE.exec(url)
  if (m) return { base: url.slice(0, m.index), format: { fit: 'fit', z: 1, x: clampPct(Number(m[1])), y: clampPct(Number(m[2])) } }
  const { base, crop } = splitCrop(url)
  return { base, format: crop ? { fit: 'fill', ...crop } : DEFAULT_BANNER }
}

/** The URL carrying this layout (none for the default: filled, centred). */
export function withBanner(url: string, f: BannerFormat): string {
  const { base } = parseBanner(url)
  if (f.fit === 'fit') return `${base}#fit=${round1(f.x)},${round1(f.y)}`
  const z = Math.round(f.z * 100) / 100
  if (z === 1 && round1(f.x) === 50 && round1(f.y) === 50) return base
  return `${base}#crop=${z},${round1(f.x)},${round1(f.y)}`
}

/** The header's height: never shorter than the server banner above the channel list (135px). */
export const BANNER_HEIGHT = 'h-40 wide:h-52'

/** The widths the header is previewed at, with its height there (BANNER_HEIGHT). */
export const BANNER_PREVIEWS = [
  { key: 'phone', w: 390, h: 160 },
  { key: 'desktop', w: 1000, h: 208 },
  { key: 'wide', w: 1800, h: 208 },
] as const

interface Request { src: string; initial: BannerFormat | null; resolve: (f: BannerFormat | null) => void }
export const useBannerFrame = create<{ req: Request | null }>(() => ({ req: null }))

/** Let the person lay out a header image (a file being uploaded, or an image URL). Null if they cancelled. */
export function frameBanner(src: File | string, initial: BannerFormat | null = null): Promise<BannerFormat | null> {
  useBannerFrame.getState().req?.resolve(null)
  const url = typeof src === 'string' ? parseBanner(src).base : URL.createObjectURL(src)
  return new Promise((resolve) => useBannerFrame.setState({
    req: { src: url, initial, resolve: (f) => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(f) } },
  }))
}

export function finishBanner(f: BannerFormat | null) {
  const req = useBannerFrame.getState().req
  useBannerFrame.setState({ req: null })
  req?.resolve(f)
}
