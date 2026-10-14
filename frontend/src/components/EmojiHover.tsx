import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { customToken, loadEmojiGroups, parseCustom, unicodeInfo } from '../lib/emoji'
import { useStore } from '../store'
import Emoji from './Emoji'

interface Tip { rect: DOMRect; value: string; name: string; desc: string }

/**
 * Clicking (or tapping) an emoji in a message (unicode `.uemoji` span or custom `img.emoji`) opens
 * Discord's detail popup: the emoji large, its `:name:` and where it comes from. Attach `onClick`
 * to the message content container; render `tip` once. Clicking anywhere else closes it.
 */
export function useEmojiHover() {
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    if (!tip) return
    // Mousedown on an emoji is left to the click handler so a second click toggles instead of reopening.
    const close = (e: Event) => { if (e.type === 'mousedown' && (e.target as HTMLElement | null)?.closest?.('.uemoji, img.emoji')) return; setTip(null) }
    window.addEventListener('mousedown', close, true); window.addEventListener('keydown', close, true); window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', close, true); window.removeEventListener('scroll', close, true) }
  }, [tip])
  const guilds = useStore((s) => s.guilds)
  const emojis = useStore((s) => s.emojis)
  const show = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const custom = el.dataset.customEmoji
    if (custom) {
      const id = /\/api\/images\/([0-9a-f-]+)/.exec((el as HTMLImageElement).src)?.[1]
      const g = id ? Object.values(guilds).find((x) => (emojis[x.id] ?? []).some((e) => e.id === id)) : undefined
      const entry = g && (emojis[g.id] ?? []).find((e) => e.id === id)
      setTip({ rect, value: entry ? customToken(entry) : `<:${custom}:${id ?? ''}>`, name: `:${custom}:`, desc: g ? `Custom emoji from ${g.name}.` : 'A custom emoji.' })
      return
    }
    const value = el.dataset.emoji
    if (!value) return
    const render = () => { const info = unicodeInfo(value); setTip({ rect, value, name: info ? `:${info.slug}:` : '', desc: 'A default emoji. You can use this emoji everywhere.' }) }
    if (unicodeInfo(value) || !value) render(); else loadEmojiGroups().then(render)
  }
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.uemoji, img.emoji')
    if (!el) return
    e.stopPropagation()
    if (tip && tip.rect.left === el.getBoundingClientRect().left && tip.rect.top === el.getBoundingClientRect().top) setTip(null); else show(el)
  }
  const node: ReactNode = tip ? createPortal(<EmojiTipBox tip={tip} />, document.body) : null
  return { onClick, tip: node }
}

function EmojiTipBox({ tip }: { tip: Tip }) {
  const c = parseCustom(tip.value)
  const custom = c ? (document.querySelector<HTMLImageElement>(`img.emoji[data-custom-emoji="${c.name}"]`)?.src ?? '') : ''
  // Anchored by its bottom edge so it sits above the emoji whatever its height; flips below near the top.
  const above = tip.rect.top > 120
  const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - 150), window.innerWidth - 308)
  const pos = above ? { bottom: window.innerHeight - tip.rect.top + 8 } : { top: tip.rect.bottom + 8 }
  return (
    <div role="tooltip" data-emoji-tip className="pop fixed z-[150] w-[300px] rounded-lg bg-[#111214] border border-white/5 shadow-2xl p-3 flex items-start gap-3" style={{ left, ...pos }} onMouseDown={(e) => e.stopPropagation()}>
      {c ? <img src={custom} alt="" className="h-12 w-12 object-contain shrink-0" /> : <Emoji value={tip.value} size={48} />}
      <div className="min-w-0 text-sm">
        {tip.name && <div className="font-bold truncate" data-emoji-tip-name>{tip.name}</div>}
        <div className="text-text-1">{tip.desc}</div>
      </div>
    </div>
  )
}
