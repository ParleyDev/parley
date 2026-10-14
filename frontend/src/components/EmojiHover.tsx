import { useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { customToken, loadEmojiGroups, parseCustom, unicodeInfo } from '../lib/emoji'
import { useStore } from '../store'
import Emoji from './Emoji'

interface Tip { rect: DOMRect; value: string; name: string; desc: string }

/**
 * Hovering an emoji in a message (unicode `.uemoji` span or custom `img.emoji`) shows Discord's
 * detail tooltip: the emoji large, its `:name:` and where it comes from. Attach the handlers to
 * the message content container; render `tip` once.
 */
export function useEmojiHover() {
  const [tip, setTip] = useState<Tip | null>(null)
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
  const onMouseOver = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.uemoji, img.emoji')
    if (el) show(el); else if (tip) setTip(null)
  }
  const onMouseLeave = () => setTip(null)
  const node: ReactNode = tip ? createPortal(<EmojiTipBox tip={tip} />, document.body) : null
  return { onMouseOver, onMouseLeave, tip: node }
}

function EmojiTipBox({ tip }: { tip: Tip }) {
  const c = parseCustom(tip.value)
  const custom = c ? (document.querySelector<HTMLImageElement>(`img.emoji[data-custom-emoji="${c.name}"]`)?.src ?? '') : ''
  const top = tip.rect.top - 8
  const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - 150), window.innerWidth - 308)
  return (
    <div role="tooltip" data-emoji-tip className="pop pointer-events-none fixed z-[150] w-[300px] rounded-lg bg-[#111214] border border-white/5 shadow-2xl p-3 flex items-start gap-3" style={{ left, top, transform: 'translateY(-100%)' }}>
      {c ? <img src={custom} alt="" className="h-12 w-12 object-contain shrink-0" /> : <Emoji value={tip.value} size={48} />}
      <div className="min-w-0 text-sm">
        {tip.name && <div className="font-bold truncate" data-emoji-tip-name>{tip.name}</div>}
        <div className="text-text-1">{tip.desc}</div>
      </div>
    </div>
  )
}
