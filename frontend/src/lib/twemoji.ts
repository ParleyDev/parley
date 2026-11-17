import meta from '../data/twemoji.json'

/*
 * Unicode emoji are drawn with Twemoji's pictures (scripts/twemoji-assets.mjs puts them under /assets/twemoji/), so
 * they look the same on every device and exist on all of them: Windows has no flag emoji at all, and older systems
 * show empty boxes for new emoji. src/data/emoji.json is kept to the Unicode release the pictures cover.
 */
const BASE = `/assets/twemoji/${meta.version}/`

/** Twemoji's file name for an emoji: its code points in hex, without FE0F unless it is a ZWJ sequence (`loose` drops it
 *  there too, for the few files named that way, like 👁️‍🗨️). */
export function twemojiFile(emoji: string, loose = false): string {
  const s = loose || !emoji.includes('‍') ? emoji.replace(/️/g, '') : emoji
  return Array.from(s, (c) => c.codePointAt(0)!.toString(16)).join('-')
}
export const twemojiSrc = (emoji: string, loose = false) => `${BASE}${twemojiFile(emoji, loose)}.svg`
