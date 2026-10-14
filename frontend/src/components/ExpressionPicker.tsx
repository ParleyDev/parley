import { Clock, Flag, Gamepad2, Leaf, Lightbulb, LoaderCircle, Pizza, Plane, Search, Shapes, Smile, Star, Upload, User, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { STORAGE_PREFIX } from '../lib/brand'
import { applyTone, customToken, getSkinTone, loadEmojiGroups, searchEmoji, setSkinTone, SKIN_TONE_NAMES, SKIN_TONES, type EmojiGroup } from '../lib/emoji'
import { colorFor, initials } from '../lib/format'
import { has, P } from '../lib/perms'
import { frequentEmoji } from '../lib/recentEmoji'
import type { Emoji as EmojiT, Gif, GifCategory, GifPage, Guild, Sticker } from '../lib/types'
import { myGuildPerms, useStore } from '../store'
import Emoji from './Emoji'

export type PickerTab = 'gif' | 'sticker' | 'emoji'

interface Props {
  tabs?: PickerTab[]
  initial?: PickerTab
  /** The server being viewed; its emoji and stickers are listed first. */
  guildId?: string | null
  onEmoji?: (token: string) => void
  onSticker?: (s: Sticker) => void
  onGif?: (g: Gif) => void
  onClose: () => void
  /** Rendered in a portal, fixed beside this rectangle (above it when there is room). */
  anchor?: DOMRect | null
  /** Positioning classes when rendered inline (absolute inside a relative parent). */
  className?: string
}

const W = 424, H = 440
const GROUP_ICONS: ReactNode[] = [<Smile size={20} />, <User size={20} />, <Leaf size={20} />, <Pizza size={20} />, <Plane size={20} />, <Gamepad2 size={20} />, <Lightbulb size={20} />, <Shapes size={20} />, <Flag size={20} />]

/**
 * Discord's expression picker: GIF, Stickers and Emoji tabs in one panel. Emoji and stickers
 * come from the store (unicode set + every server's custom ones); GIFs from the backend proxy.
 */
export default function ExpressionPicker({ tabs = ['gif', 'sticker', 'emoji'], initial, guildId, onEmoji, onSticker, onGif, onClose, anchor, className = '' }: Props) {
  const [tab, setTab] = useState<PickerTab>(initial ?? tabs[tabs.length - 1])
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const w = Math.min(W, window.innerWidth - 16), h = Math.min(H, window.innerHeight - 16)
    const above = anchor.top - h - 8
    const top = above >= 8 ? above : Math.min(anchor.bottom + 8, window.innerHeight - h - 8)
    const left = Math.max(8, Math.min(anchor.right - w, window.innerWidth - w - 8))
    setPos({ left, top })
  }, [anchor])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const panel = (
    <div ref={ref} data-expression-picker data-picker-tab={tab} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      className={`pop flex flex-col rounded-xl bg-[#2b2d31] border border-white/10 shadow-2xl text-text-0 overflow-hidden ${anchor ? 'fixed z-[110]' : `absolute z-[110] ${className}`} max-md:!fixed max-md:!inset-x-2 max-md:!bottom-2 max-md:!top-auto max-md:!w-auto`}
      style={anchor ? { width: Math.min(W, window.innerWidth - 16), height: Math.min(H, window.innerHeight - 16), left: pos?.left ?? -9999, top: pos?.top ?? -9999 } : { width: Math.min(W, window.innerWidth - 16), height: Math.min(H, window.innerHeight - 16) }}>
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-white/5 shrink-0">
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} data-tab={t} className={`px-3 py-1.5 text-[15px] font-semibold rounded-t-md border-b-2 -mb-px ${tab === t ? 'text-text-0 border-text-0' : 'text-text-2 border-transparent hover:text-text-1'}`}>
              {t === 'gif' ? 'GIFs' : t === 'sticker' ? 'Stickers' : 'Emoji'}
            </button>
          ))}
          <button type="button" onClick={onClose} className="ml-auto text-text-2 hover:text-text-0 md:hidden" title="Close"><X size={18} /></button>
        </div>
      )}
      {tab === 'emoji' && <EmojiTab guildId={guildId} onPick={(t) => { onEmoji?.(t) }} />}
      {tab === 'sticker' && <StickerTab guildId={guildId} onPick={(s) => { onSticker?.(s); onClose() }} />}
      {tab === 'gif' && <GifTab onPick={(g) => { onGif?.(g); onClose() }} />}
    </div>
  )
  const content = (
    <>
      <div className="fixed inset-0 z-[105]" onMouseDown={(e) => { e.stopPropagation(); onClose() }} />
      {panel}
    </>
  )
  return anchor ? createPortal(content, document.body) : content
}

// ---------------------------------------------------------------- emoji

function EmojiTab({ guildId, onPick }: { guildId?: string | null; onPick: (token: string) => void }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<{ token: string; name: string } | null>(null)
  const [tone, setTone] = useState(getSkinTone)
  const [toneOpen, setToneOpen] = useState(false)
  const pickTone = (t: number) => { setTone(t); setSkinTone(t); setToneOpen(false) }
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const emojis = useStore((s) => s.emojis)
  const gridRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { loadEmojiGroups().then(setGroups) }, [])
  useEffect(() => { inputRef.current?.focus() }, [])
  const ordered = useMemo(() => {
    const list = guilds.filter((g) => (emojis[g.id]?.length ?? 0) > 0)
    return guildId ? [...list.filter((g) => g.id === guildId), ...list.filter((g) => g.id !== guildId)] : list
  }, [guilds, emojis, guildId])
  const allCustom = useMemo(() => ordered.flatMap((g) => emojis[g.id] ?? []), [ordered, emojis])
  const frequent = useMemo(() => frequentEmoji(18), [])
  const results = useMemo(() => (groups && q.trim() ? searchEmoji(q, groups, allCustom, 90) : null), [q, groups, allCustom])
  const jump = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' })
  const nameOf = (token: string) => { const c = /^<a?:([^:]+):/.exec(token); return c ? `:${c[1]}:` : token }

  const cell = (token: string, label: string, key: string) => (
    <button key={key} type="button" onClick={() => onPick(token)} onMouseEnter={() => setHover({ token, name: label })} title={label} data-emoji-btn={label}
      className="h-10 w-10 rounded-md flex items-center justify-center text-[26px] hover:bg-white/10 leading-none">
      <Emoji value={token} size={30} />
    </button>
  )
  return (
    <>
      <div className="px-3 py-2 shrink-0 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-md bg-[#1e1f22] px-2.5 h-9 min-w-0">
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the perfect emoji" data-emoji-search className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-2 min-w-0" />
          {q ? <button type="button" onClick={() => setQ('')} className="text-text-2 hover:text-text-0"><X size={16} /></button> : <Search size={16} className="text-text-2" />}
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setToneOpen((o) => !o)} title={`Skin tone: ${SKIN_TONE_NAMES[tone]}`} data-skin-tone={tone} className="h-9 w-9 rounded-md hover:bg-white/10 flex items-center justify-center text-[22px] leading-none">{applyTone('✋', tone)}</button>
          {toneOpen && (
            <div className="pop absolute right-0 top-full mt-1 z-20 flex gap-0.5 rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1" data-skin-tone-menu>
              {SKIN_TONES.map((_, i) => <button key={i} type="button" onClick={() => pickTone(i)} title={SKIN_TONE_NAMES[i]} data-tone-option={i} className={`h-9 w-9 rounded-md flex items-center justify-center text-[22px] leading-none hover:bg-white/10 ${i === tone ? 'bg-white/10' : ''}`}>{applyTone('✋', i)}</button>)}
            </div>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {!results && (
          <div className="w-12 shrink-0 overflow-y-auto border-r border-white/5 py-1 flex flex-col items-center gap-1" data-emoji-rail>
            <RailBtn title="Frequently Used" onClick={() => jump('frequent')}><Clock size={20} /></RailBtn>
            {ordered.map((g) => <RailBtn key={g.id} title={g.name} onClick={() => jump(`g-${g.id}`)}><GuildIcon g={g} /></RailBtn>)}
            {ordered.length > 0 && <div className="my-1 h-px w-6 bg-white/10" />}
            {(groups ?? []).map((g, i) => <RailBtn key={g.name} title={g.name} onClick={() => jump(`u-${i}`)}>{GROUP_ICONS[i]}</RailBtn>)}
          </div>
        )}
        <div ref={gridRef} className="flex-1 min-w-0 overflow-y-auto px-2 pb-2" data-emoji-grid>
          {!groups && <div className="flex items-center justify-center h-full text-text-2"><LoaderCircle size={22} className="animate-spin" /></div>}
          {groups && results && (
            results.length === 0 ? <div className="py-10 text-center text-sm text-text-2">No emoji found</div> : (
              <div className="grid grid-cols-[repeat(auto-fill,2.5rem)] gap-0.5 pt-1">
                {results.map((r) => r.kind === 'custom' ? cell(customToken(r.emoji), `:${r.emoji.name}:`, `c-${r.emoji.id}`) : cell(r.emoji.tone ? applyTone(r.emoji.emoji, tone) : r.emoji.emoji, `:${r.name}:`, `u-${r.emoji.emoji}`))}
              </div>
            )
          )}
          {groups && !results && (
            <>
              <Section id="frequent" title="Frequently Used">{frequent.map((e) => cell(e, nameOf(e), `f-${e}`))}</Section>
              {ordered.map((g) => <Section key={g.id} id={`g-${g.id}`} title={g.name}>{(emojis[g.id] ?? []).map((e) => cell(customToken(e), `:${e.name}:`, e.id))}</Section>)}
              {groups.map((g, i) => <Section key={g.name} id={`u-${i}`} title={g.name}>{g.emojis.map((e) => cell(e.tone ? applyTone(e.emoji, tone) : e.emoji, `:${e.slug}:`, e.emoji))}</Section>)}
            </>
          )}
        </div>
      </div>
      <div className="h-12 shrink-0 border-t border-white/5 bg-[#232428] px-3 flex items-center gap-3 text-sm">
        {hover ? <><Emoji value={hover.token} size={28} /><span className="font-semibold truncate" data-emoji-preview>{hover.name}</span></> : <span className="text-text-2">Pick an emoji</span>}
      </div>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode[] }) {
  if (!children.length) return null
  return (
    <div data-section={id}>
      <div className="sticky top-0 z-10 bg-[#2b2d31] py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2">{title}</div>
      <div className="grid grid-cols-[repeat(auto-fill,2.5rem)] gap-0.5">{children}</div>
    </div>
  )
}

function RailBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return <button type="button" title={title} onClick={onClick} className="h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-text-2 hover:bg-white/10 hover:text-text-0">{children}</button>
}

function GuildIcon({ g, size = 24 }: { g: Pick<Guild, 'id' | 'name' | 'icon_url'>; size?: number }) {
  return g.icon_url
    ? <img src={g.icon_url} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ width: size, height: size, background: colorFor(g.id) }}>{initials(g.name)}</span>
}

// ---------------------------------------------------------------- stickers

function StickerTab({ guildId, onPick }: { guildId?: string | null; onPick: (s: Sticker) => void }) {
  const [q, setQ] = useState('')
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const stickers = useStore((s) => s.stickers)
  const openModal = useStore((s) => s.openModal)
  const perms = useStore((s) => (guildId ? myGuildPerms(s, guildId) : 0))
  const canManage = !!guildId && has(perms, P.MANAGE_GUILD)
  const ordered = useMemo(() => {
    const list = guilds.filter((g) => (stickers[g.id]?.length ?? 0) > 0)
    return guildId ? [...list.filter((g) => g.id === guildId), ...list.filter((g) => g.id !== guildId)] : list
  }, [guilds, stickers, guildId])
  const needle = q.trim().toLowerCase()
  const match = (s: Sticker) => !needle || s.name.toLowerCase().includes(needle) || s.tags.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
  const total = ordered.reduce((n, g) => n + (stickers[g.id] ?? []).filter(match).length, 0)
  return (
    <>
      <div className="px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 rounded-md bg-[#1e1f22] px-2.5 h-9">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stickers" data-sticker-search className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-2 min-w-0" />
          <Search size={16} className="text-text-2" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3" data-sticker-grid>
        {total === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-sm text-text-2 px-6">
            <Upload size={28} />
            <div>{needle ? 'No stickers match that search.' : 'No stickers yet. Servers can upload their own under Server Settings › Stickers.'}</div>
            {canManage && !needle && <button type="button" className="btn-primary mt-1" onClick={() => openModal({ kind: 'guildSettings', guildId: guildId!, tab: 'stickers' })} data-upload-sticker>Upload a sticker</button>}
          </div>
        )}
        {ordered.map((g) => {
          const list = (stickers[g.id] ?? []).filter(match)
          if (!list.length) return null
          return (
            <div key={g.id}>
              <div className="sticky top-0 z-10 bg-[#2b2d31] py-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-text-2"><GuildIcon g={g} size={16} />{g.name}</div>
              <div className="grid grid-cols-4 gap-2">
                {list.map((s) => (
                  <button key={s.id} type="button" onClick={() => onPick(s)} title={s.description ? `${s.name} — ${s.description}` : s.name} data-sticker-btn={s.name}
                    className="aspect-square rounded-lg bg-[#1e1f22] hover:bg-white/10 p-1.5 flex items-center justify-center">
                    <img src={s.url} alt={s.name} className="max-h-full max-w-full object-contain" draggable={false} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- gifs

const FAV_KEY = `${STORAGE_PREFIX}gifFavorites`
function loadFavs(): Gif[] { try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') } catch { return [] } }
function saveFavs(f: Gif[]) { try { localStorage.setItem(FAV_KEY, JSON.stringify(f.slice(0, 200))) } catch { /* ignore */ } }

function GifTab({ onPick }: { onPick: (g: Gif) => void }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [cats, setCats] = useState<GifCategory[] | null>(null)
  const [page, setPage] = useState<GifPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [favs, setFavs] = useState<Gif[]>(loadFavs)
  const [showFavs, setShowFavs] = useState(false)
  const reqSeq = useRef(0)

  useEffect(() => {
    api.get<GifCategory[]>('/gifs/categories').then(setCats).catch((e: Error) => { setCats([]); setError(e.message) })
  }, [])
  // Debounced search; empty query returns to the categories view.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (!term) { setPage(null); return }
    const seq = ++reqSeq.current
    setLoading(true); setShowFavs(false)
    api.get<GifPage>(term === '__trending' ? '/gifs/trending' : `/gifs/search?q=${encodeURIComponent(term)}`)
      .then((p) => { if (seq === reqSeq.current) { setPage(p); setError(null) } })
      .catch((e: Error) => { if (seq === reqSeq.current) setError(e.message) })
      .finally(() => { if (seq === reqSeq.current) setLoading(false) })
  }, [term])
  const more = async () => {
    if (!page?.next || loading) return
    setLoading(true)
    try {
      const p = await api.get<GifPage>(term === '__trending' ? `/gifs/trending?pos=${encodeURIComponent(page.next)}` : `/gifs/search?q=${encodeURIComponent(term)}&pos=${encodeURIComponent(page.next)}`)
      setPage({ ...p, results: [...page.results, ...p.results] })
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  const isFav = (g: Gif) => favs.some((f) => f.url === g.url)
  const toggleFav = (g: Gif) => { const next = isFav(g) ? favs.filter((f) => f.url !== g.url) : [g, ...favs]; setFavs(next); saveFavs(next) }
  const back = () => { setQ(''); setTerm(''); setShowFavs(false) }
  const list = showFavs ? favs : page?.results ?? null

  return (
    <>
      <div className="px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 rounded-md bg-[#1e1f22] px-2.5 h-9">
          {(term || showFavs) && <button type="button" onClick={back} className="text-text-2 hover:text-text-0" title="Back"><X size={16} /></button>}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setTerm(q.trim()) }} placeholder="Search Tenor" data-gif-search className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-2 min-w-0" />
          <Search size={16} className="text-text-2" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3" data-gif-body>
        {error && !list && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-sm text-text-2 px-6" data-gif-error>
            <Search size={28} />
            <div>{error}</div>
          </div>
        )}
        {!error && !list && (
          <div className="grid grid-cols-2 gap-2">
            {favs.length > 0 && <Tile label="Favorites" image={favs[0].preview} onClick={() => setShowFavs(true)} icon={<Star size={14} className="fill-current" />} />}
            <Tile label="Trending GIFs" image={cats?.[0]?.image ?? ''} onClick={() => { setQ(''); setTerm('__trending') }} />
            {cats === null && <div className="col-span-2 flex justify-center py-8 text-text-2"><LoaderCircle size={22} className="animate-spin" /></div>}
            {(cats ?? []).map((c) => <Tile key={c.name} label={c.name} image={c.image} onClick={() => setQ(c.name)} />)}
          </div>
        )}
        {list && (
          list.length === 0 && !loading ? <div className="py-10 text-center text-sm text-text-2">{showFavs ? 'No favorites yet. Hover a GIF and press the star.' : 'No GIFs found'}</div> : (
            <div className="grid grid-cols-2 gap-2 items-start">
              {[0, 1].map((col) => (
                <div key={col} className="flex flex-col gap-2">
                  {list.filter((_, i) => i % 2 === col).map((g) => (
                    <div key={g.id + g.url} className="group relative rounded-lg overflow-hidden bg-[#1e1f22]">
                      <button type="button" onClick={() => onPick(g)} className="block w-full" title={g.title} data-gif-tile>
                        <img src={g.preview || g.url} alt={g.title} loading="lazy" className="w-full block" style={g.width && g.height ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
                      </button>
                      <button type="button" onClick={() => toggleFav(g)} title={isFav(g) ? 'Remove from favorites' : 'Add to favorites'} data-gif-fav
                        className={`absolute right-1.5 top-1.5 h-7 w-7 rounded-full bg-black/60 flex items-center justify-center text-white ${isFav(g) ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                        <Star size={14} className={isFav(g) ? 'fill-current' : ''} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        )}
        {list && !showFavs && page?.next && <button type="button" onClick={more} disabled={loading} className="btn-ghost w-full mt-2 justify-center" data-gif-more>{loading ? 'Loading…' : 'Load more'}</button>}
        {loading && !list && <div className="flex justify-center py-8 text-text-2"><LoaderCircle size={22} className="animate-spin" /></div>}
      </div>
    </>
  )
}

function Tile({ label, image, onClick, icon }: { label: string; image: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-gif-category={label} className="relative h-[100px] rounded-lg overflow-hidden bg-[#1e1f22] bg-cover bg-center hover:brightness-110" style={image ? { backgroundImage: `url(${image})` } : undefined}>
      <span className="absolute inset-0 bg-black/45" />
      <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-white font-bold text-[15px] drop-shadow">{icon}{label}</span>
    </button>
  )
}

export type { EmojiT as CustomEmoji }
