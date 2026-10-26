import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { publicOrigin } from './InviteCard'

export interface Embed { url: string; title?: string; description?: string; image?: string; site_name?: string; color?: string; large_image?: boolean; video?: string }

const cache = new Map<string, Promise<Embed | null>>()
const lookup = (url: string) => {
  let p = cache.get(url)
  if (!p) { p = api.get<Embed | null>(`/embeds?url=${encodeURIComponent(url)}`).catch(() => null); cache.set(url, p) }
  return p
}

const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,!?:;]/i
const IMAGE_RE = /\.(gif|png|jpe?g|webp|avif|mp4|webm)(\?|#|$)/i

/** Previewable links in a message, up to `max` (not bare media, not our own app, no repeats). */
export function previewLinks(content: string, max = 5): string[] {
  if (!content) return []
  // Skip code: anything inside backticks never embeds; <url> suppresses that link, like Discord.
  const stripped = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/<[^>]*>/g, ' ')
  const out: string[] = []
  for (const m of stripped.matchAll(new RegExp(URL_RE.source, 'gi'))) {
    const url = m[0]
    if (IMAGE_RE.test(url.split(/[?#]/)[0]) || out.includes(url)) continue
    // Links to this instance (either the address being browsed or its public URL) never unfurl: invites get a card instead.
    try { const origin = new URL(url).origin; if (origin === location.origin || origin === publicOrigin()) continue } catch { continue }
    out.push(url)
    if (out.length >= max) break
  }
  return out
}

/** The first previewable link in a message. */
export function firstLink(content: string): string | null { return previewLinks(content, 1)[0] ?? null }

/** Sites we can play inline: an iframe URL for the page, and its height. */
export function playerFor(url: string): { src: string; height: number; kind: 'youtube' | 'spotify' | 'twitch'; thumb?: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  let yt: string | null = null
  if (host === 'youtube.com' || host === 'music.youtube.com') yt = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)?.[2] ?? null
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0] || null
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`, height: 0, thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/.exec(u.pathname)
    if (m) return { kind: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 }
  }
  if (host === 'twitch.tv') {
    const parent = location.hostname
    const vid = /^\/videos\/(\d+)/.exec(u.pathname)?.[1]
    if (vid) return { kind: 'twitch', src: `https://player.twitch.tv/?video=${vid}&parent=${parent}&autoplay=true`, height: 0 }
    const ch = /^\/([A-Za-z0-9_]{3,25})\/?$/.exec(u.pathname)?.[1]
    if (ch && !['directory', 'videos', 'settings', 'p'].includes(ch)) return { kind: 'twitch', src: `https://player.twitch.tv/?channel=${ch}&parent=${parent}&autoplay=true`, height: 0 }
  }
  return null
}

/** OpenGraph card under a message for a link (with an inline player for YouTube, Spotify and Twitch, a video for
 *  og:video, a large picture when the page asks for one and its theme colour). Renders nothing until there's data. */
export default function LinkEmbed({ url }: { url: string }) {
  const [embed, setEmbed] = useState<Embed | null | undefined>(undefined)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { let live = true; lookup(url).then((e) => { if (live) setEmbed(e) }); return () => { live = false } }, [url])
  const player = playerFor(url)
  if (player && (player.kind === 'spotify' || playing)) {
    return (
      <div className="mt-1 w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-black" data-link-player={player.kind}>
        <iframe src={player.src} title={embed?.title ?? player.kind} className="block w-full" style={player.height ? { height: player.height } : { aspectRatio: '16 / 9' }} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    )
  }
  if (player) {
    const title = embed?.title ?? (player.kind === 'youtube' ? 'YouTube' : 'Twitch')
    const thumb = embed?.image ?? player.thumb
    return (
      <div className="mt-1 w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-bg-1" style={{ borderLeft: `4px solid ${embed?.color ?? (player.kind === 'youtube' ? '#ff0000' : '#9146ff')}` }} data-link-embed={url} data-link-player-card={player.kind}>
        <div className="p-3 pb-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-sky-400 hover:underline" data-embed-title>{title}</a>
          {embed?.description && <div className="mt-0.5 text-sm text-text-1 line-clamp-2">{embed.description}</div>}
        </div>
        <button type="button" onClick={() => setPlaying(true)} className="group relative block w-full bg-black" style={{ aspectRatio: '16 / 9' }} title="Play" data-link-play>
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover opacity-90" loading="lazy" />}
          <span className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-2xl text-white group-hover:bg-danger">▶</span>
        </button>
      </div>
    )
  }
  if (!embed) return null
  if (embed.large_image || embed.video) {
    return (
      <div className="mt-1 w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-bg-1" style={embed.color ? { borderLeft: `4px solid ${embed.color}` } : undefined} data-link-embed={embed.url} data-embed-large>
        <div className="p-3 pb-2">
          <span className="block text-[11px] text-text-2 truncate" data-embed-site>{embed.site_name}</span>
          {embed.title && <a href={embed.url} target="_blank" rel="noopener noreferrer" className="block font-semibold text-sky-400 hover:underline break-words" data-embed-title>{embed.title}</a>}
          {embed.description && <span className="mt-0.5 block text-sm text-text-1 line-clamp-3 break-words" data-embed-desc>{embed.description}</span>}
        </div>
        {embed.video ? <video src={embed.video} poster={embed.image} controls preload="none" className="block w-full bg-black" data-embed-video /> : embed.image && <img src={embed.image} alt="" loading="lazy" className="block max-h-[300px] w-full object-cover" data-embed-image onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
      </div>
    )
  }
  const host = (() => { try { return new URL(embed.url).host } catch { return '' } })()
  return (
    <a href={embed.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex max-w-[520px] overflow-hidden rounded-lg border border-line bg-bg-1 hover:border-text-2" data-link-embed={embed.url}>
      <span className="w-1 shrink-0 bg-accent" style={embed.color ? { background: embed.color } : undefined} aria-hidden data-embed-color={embed.color} />
      <span className="min-w-0 flex-1 p-3">
        <span className="block text-[11px] text-text-2 truncate" data-embed-site>{embed.site_name || host}</span>
        {embed.title && <span className="block font-semibold text-sky-400 hover:underline break-words" data-embed-title>{embed.title}</span>}
        {embed.description && <span className="mt-0.5 block text-sm text-text-1 line-clamp-3 break-words" data-embed-desc>{embed.description}</span>}
      </span>
      {embed.image && <img src={embed.image} alt="" loading="lazy" className="h-20 w-20 shrink-0 object-cover m-3 ml-0 rounded" data-embed-image onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
    </a>
  )
}
