import type { CSSProperties } from 'react'
import { create } from 'zustand'

/**
 * How a profile picture, banner or server icon is framed: the image itself is stored as uploaded, and its URL carries
 * `#crop=<zoom>,<x>,<y>`: zoom (1 = just covers the frame) and the focus point in percent of the image. The browser
 * ignores the fragment when fetching, so the original is downloaded and cached once; drawing applies the framing.
 */
export interface Crop { z: number; x: number; y: number }

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const RE = /#crop=([\d.]+),([\d.]+),([\d.]+)$/

export function splitCrop(url: string | null | undefined): { base: string; crop: Crop | null } {
  if (!url) return { base: '', crop: null }
  const m = RE.exec(url)
  if (!m) return { base: url, crop: null }
  const crop = { z: Math.min(5, Math.max(1, Number(m[1]))), x: Math.min(100, Math.max(0, Number(m[2]))), y: Math.min(100, Math.max(0, Number(m[3]))) }
  return { base: url.slice(0, m.index), crop: crop.z === 1 && crop.x === 50 && crop.y === 50 ? null : crop }
}

/** The URL with this framing (none for the default: whole image, centred). */
export function withCrop(url: string, crop: Crop | null): string {
  const { base } = splitCrop(url)
  if (!crop || (round(crop.z, 2) === 1 && round(crop.x) === 50 && round(crop.y) === 50)) return base
  return `${base}#crop=${round(crop.z, 2)},${round(crop.x)},${round(crop.y)}`
}

/** Styles that frame an <img> filling its (clipping) box: cover, focus point, zoom around it. */
export function cropStyle(crop: Crop): CSSProperties {
  return { objectFit: 'cover', objectPosition: `${crop.x}% ${crop.y}%`, transform: crop.z === 1 ? undefined : `scale(${crop.z})`, transformOrigin: `${crop.x}% ${crop.y}%` }
}

/** A plain `background-image` for a picture without framing; framed ones are drawn by <CropLayer> instead. */
export function bgUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return splitCrop(url).crop ? undefined : `url(${url})`
}

/** The shape each picture is shown as. */
export const SHAPES = {
  /** Profile picture, server profile picture: a circle. */
  avatar: { aspect: 1, round: true, title: 'Crop profile picture' },
  /** Server icon: a rounded square. */
  icon: { aspect: 1, round: false, title: 'Crop server icon' },
  /** Profile banner (the top of the profile card). */
  profileBanner: { aspect: 5 / 2, round: false, title: 'Crop banner' },
  /** Server banner above the channel list, Discover cards and invite backgrounds. */
  serverBanner: { aspect: 16 / 9, round: false, title: 'Crop server banner' },
} as const
export type CropShape = keyof typeof SHAPES

interface Request { src: string; shape: CropShape; initial: Crop | null; resolve: (c: Crop | null) => void }
export const useCrop = create<{ req: Request | null }>(() => ({ req: null }))

/** Let the person zoom and position a picture (a file being uploaded, or an image URL). Null if they cancelled. */
export function frameImage(src: File | string, shape: CropShape, initial: Crop | null = null): Promise<Crop | null> {
  useCrop.getState().req?.resolve(null)
  const url = typeof src === 'string' ? splitCrop(src).base : URL.createObjectURL(src)
  return new Promise((resolve) => useCrop.setState({
    req: { src: url, shape, initial, resolve: (c) => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(c) } },
  }))
}

export function finishCrop(c: Crop | null) {
  const req = useCrop.getState().req
  useCrop.setState({ req: null })
  req?.resolve(c)
}
