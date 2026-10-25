import { createContext, useState, type FocusEvent } from 'react'
import { decorationsMayAnimate } from './decorations'

/**
 * When animated avatars and decorations play, Discord-style: always on profile cards and popouts; in messages and
 * list rows only while that message or row is hovered, focused or highlighted; never with reduced motion. Everywhere
 * else they show a still first frame. A container says "play" by providing `true` here; Avatar also plays while
 * the avatar itself is hovered.
 */
export const AvatarMotion = createContext(false)

export const mayAnimate = decorationsMayAnimate

/** Hover/keyboard-focus state for a message or row, plus the handlers to spread on its element. Only keyboard focus
 *  counts (`:focus-visible`): clicking a name to open a popout must not leave the message playing. */
export function useHoverMotion() {
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const bind = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: (e: FocusEvent<HTMLElement>) => setFocus((e.target as HTMLElement).matches(':focus-visible')),
    onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false) },
  }
  return [hover || focus, bind] as const
}

/** Our uploaded profile images have a still first frame at `<url>/static` (the original when it isn't animated). */
export const stillImageUrl = (url: string) => (/^\/api\/images\/[0-9a-f-]{36}$/i.test(url) ? `${url}/static` : url)
