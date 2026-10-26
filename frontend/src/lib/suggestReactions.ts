import type { Message } from './types'
import { frequentEmoji } from './recentEmoji'

/** Words that make a reaction likely, checked in order; first hits win. */
const HINTS: [RegExp, string][] = [
  [/\b(lol|lmao|rofl|haha+|hehe|funny|😂|🤣)\b/i, '😂'],
  [/\b(thanks|thank you|thx|ty|appreciate)\b/i, '🙏'],
  [/\b(congrats|congratulations|grats|birthday|bday|hbd|celebrat|won|win|shipped|released?)\b/i, '🎉'],
  [/\b(love|lovely|cute|adorable|❤️|<3)\b/i, '❤️'],
  [/\b(fire|lit|insane|amazing|awesome|incredible|hype)\b/i, '🔥'],
  [/\b(sad|sorry|unfortunately|rip|miss you|condolences)\b/i, '😢'],
  [/\b(wow|whoa|omg|no way|really\?)\b/i, '😮'],
  [/\b(agree|yes|yep|yeah|sounds good|ok|okay|sure|done|great|nice|good)\b/i, '👍'],
  [/\?\s*$/, '🤔'],
  [/\b(look|see|check (this|it) out|watch)\b/i, '👀'],
]

/** The `n` reactions most likely to fit this message: up to `maxHints` from its words and emoji, then your most used. */
export function suggestReactions(m: Pick<Message, 'content'>, n = 3, maxHints = n): string[] {
  const hints: string[] = []
  const text = m.content ?? ''
  for (const [re, emoji] of HINTS) if (re.test(text) && !hints.includes(emoji)) hints.push(emoji)
  for (const e of text.match(/\p{Extended_Pictographic}️?/gu) ?? []) if (!hints.includes(e)) hints.push(e)
  const out = hints.slice(0, maxHints)
  for (const e of frequentEmoji(n + maxHints)) if (!out.includes(e)) out.push(e)
  return out.slice(0, n)
}
