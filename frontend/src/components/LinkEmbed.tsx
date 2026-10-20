import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { publicOrigin } from './InviteCard'

export interface Embed { url: string; title?: string; description?: string; image?: string; site_name?: string }

const cache = new Map<string, Promise<Embed | null>>()
const lookup = (url: string) => {
  let p = cache.get(url)
  if (!p) { p = api.get<Embed | null>(`/embeds?url=${encodeURIComponent(url)}`).catch(() => null); cache.set(url, p) }
  return p
}

const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,!?:;]/i
const IMAGE_RE = /\.(gif|png|jpe?g|webp|avif|mp4|webm)(\?|#|$)/i

/** The first previewable link in a message (not bare media, not our own app). */
export function firstLink(content: string): string | null {
  if (!content) return null
  // Skip code: anything inside backticks never embeds.
  const stripped = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/<[^>]*>/g, ' ')
  const m = URL_RE.exec(stripped)
  if (!m) return null
  const url = m[0]
  if (IMAGE_RE.test(url.split(/[?#]/)[0])) return null
  // Links to this instance (either the address being browsed or its public URL) never unfurl: invites get a card instead.
  try {
    const origin = new URL(url).origin
    if (origin === location.origin || origin === publicOrigin()) return null
  } catch { return null }
  return url
}

/** OpenGraph card under a message for its first link. Renders nothing until (and unless) the server has data. */
export default function LinkEmbed({ url }: { url: string }) {
  const [embed, setEmbed] = useState<Embed | null | undefined>(undefined)
  useEffect(() => { let live = true; lookup(url).then((e) => { if (live) setEmbed(e) }); return () => { live = false } }, [url])
  if (!embed) return null
  const host = (() => { try { return new URL(embed.url).host } catch { return '' } })()
  return (
    <a href={embed.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex max-w-[520px] overflow-hidden rounded-lg border border-line bg-bg-1 hover:border-text-2" data-link-embed={embed.url}>
      <span className="w-1 shrink-0 bg-accent" aria-hidden />
      <span className="min-w-0 flex-1 p-3">
        <span className="block text-[11px] text-text-2 truncate" data-embed-site>{embed.site_name || host}</span>
        {embed.title && <span className="block font-semibold text-sky-400 hover:underline break-words" data-embed-title>{embed.title}</span>}
        {embed.description && <span className="mt-0.5 block text-sm text-text-1 line-clamp-3 break-words" data-embed-desc>{embed.description}</span>}
      </span>
      {embed.image && <img src={embed.image} alt="" loading="lazy" className="h-20 w-20 shrink-0 object-cover m-3 ml-0 rounded" data-embed-image onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
    </a>
  )
}
