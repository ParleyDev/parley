import type { MouseEvent } from 'react'

/** Viewport rectangle of whatever was clicked, so a popout can sit next to it. */
export interface Anchor { x: number; y: number; w: number; h: number }

export function anchorOf(e: MouseEvent<HTMLElement>): Anchor {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
