import { Ban, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES, frameClass, nameplateClass, useOptions, type CosmeticKind } from '../../lib/cosmetics'
import { assetFile, layeredThumb, useCatalog, type LayeredItem } from '../../lib/assetCatalog'
import { ASSET_PREFIX, useAssetDecorations } from '../../lib/decorations'
import { useT } from '../../lib/i18n'
import { nameLook } from '../../lib/nameStyle'
import NameText from '../NameText'
import { DECORATIONS } from '../../lib/types'
import { useLazySlice } from '../../lib/useLazySlice'
import Avatar from '../Avatar'
import { LazyVideo, NameplateVideo, nameplateSrc, useAssetNameplates } from '../Nameplate'
import ProfileCard from '../ProfileCard'
import ProfileEffect from '../ProfileEffect'

/** One choice in a picker: a built-in (or admin-made) one, or one from the instance's assets folder. */
export interface CosmeticOption { value: string; name: string; description?: string; tags?: string[]; group: 'builtin' | 'folder'; glyph?: string; thumb?: string; still?: string }

/** Every tag the items carry, most used first, with how many have it. */
export function tagCounts(items: { tags?: string[] | null }[]): [string, number][] {
  const n = new Map<string, number>()
  for (const it of items) for (const tag of it.tags ?? []) n.set(tag, (n.get(tag) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Does a search match this item's name, description or one of its tags? (`needle` is lower case.) */
export const matchesSearch = (needle: string, fields: (string | null | undefined)[], tags?: string[] | null) =>
  !needle || fields.some((f) => f?.toLowerCase().includes(needle)) || !!tags?.some((tag) => tag.includes(needle.replace(/^#/, '')))

/** A row of tags to filter by: click one to show only items with it, again to show all. */
export function TagFilter({ tags, active, onPick }: { tags: [string, number][]; active: string | null; onPick: (tag: string | null) => void }) {
  const t = useT()
  if (!tags.length) return null
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t('Tags')} data-cosmetic-tags>
      {tags.map(([tag, n]) => (
        <button key={tag} type="button" onClick={() => onPick(active === tag ? null : tag)} aria-pressed={active === tag}
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${active === tag ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-cosmetic-tag={tag}>
          #{tag} <span className={active === tag ? 'text-white/70' : 'text-text-2'}>{n}</span>
        </button>
      ))}
    </div>
  )
}

const layered = (kind: 'effect' | 'frame', x: LayeredItem): CosmeticOption => ({
  value: `asset:${x.id}`, name: x.name, description: x.description || undefined, tags: x.tags, group: 'folder',
  thumb: layeredThumb(kind === 'effect' ? 'profile-effects' : 'profile-frames', x) ?? undefined,
  still: kind === 'effect' && x.still ? assetFile('profile-effects', x.id, x.still) : undefined,
})

/** Everything a person can pick for a kind, built-in first; the folder's part is null while it loads. */
export function useCosmeticOptions(kind: CosmeticKind): { builtin: CosmeticOption[]; folder: CosmeticOption[] | null } {
  const decos = useOptions('decoration', DECORATIONS), plates = useOptions('nameplate', NAMEPLATES)
  const effects = useOptions('effect', PROFILE_EFFECTS), frames = useOptions('frame', PROFILE_FRAMES)
  const folderDecos = useAssetDecorations()
  const folderPlates = useAssetNameplates()
  const folderEffects = useCatalog(kind === 'effect' ? 'profile-effects' : ('' as 'profile-effects'))
  const folderFrames = useCatalog(kind === 'frame' ? 'profile-frames' : ('' as 'profile-frames'))
  return useMemo(() => {
    const list = { decoration: decos, nameplate: plates, effect: effects, frame: frames }[kind]
    const builtin = list.filter((o) => o.id).map((o): CosmeticOption => ({
      value: o.id, name: o.label, group: 'builtin',
      description: 'description' in o && typeof o.description === 'string' ? o.description : undefined,
      glyph: 'data' in o ? o.data.glyph : 'glyph' in o ? (o.glyph as string) : undefined,
    }))
    const folder = kind === 'decoration' ? folderDecos?.map((d): CosmeticOption => ({ value: ASSET_PREFIX + d.id, name: d.name, description: d.description, tags: d.tags, group: 'folder' })) ?? null
      : kind === 'nameplate' ? folderPlates?.map((n): CosmeticOption => ({ value: `asset:${n.id}`, name: n.name, description: n.description, tags: n.tags, group: 'folder' })) ?? null
        : kind === 'effect' ? folderEffects?.map((x) => layered('effect', x)) ?? null
          : folderFrames?.map((x) => layered('frame', x)) ?? null
    return { builtin, folder }
  }, [kind, decos, plates, effects, frames, folderDecos, folderPlates, folderEffects, folderFrames])
}

type PreviewUser = ComponentProps<typeof ProfileCard>['user'] & { nameplate?: string }

/**
 * How a choice looks where people see it: a decoration on the avatar at the sizes it is drawn (profile, chat,
 * member list), a nameplate behind the name in a member list, an effect or frame on the whole profile card.
 */
export function CosmeticPreview({ kind, value, user }: { kind: CosmeticKind; value: string; user: PreviewUser }) {
  const t = useT()
  if (kind === 'decoration') return (
    <div className="flex items-center justify-center gap-6 rounded-xl bg-bg-0/60 p-6" data-cosmetic-live={value || 'none'}>
      <Avatar user={user} decoration={value} size={136} animate />
      <div className="flex flex-col items-center gap-4 rounded-xl bg-bg-1/80 p-3">
        <Avatar user={user} decoration={value} size={72} animate />
        <Avatar user={{ ...user, status: 'online' }} decoration={value} size={44} presence animate />
        <Avatar user={{ ...user, status: 'online' }} decoration={value} size={32} presence animate />
      </div>
    </div>
  )
  if (kind === 'nameplate') {
    const look = nameLook(user)
    const ghost = (w: string) => <div className="flex items-center gap-3 px-2 py-1.5 opacity-50"><span className="h-8 w-8 shrink-0 rounded-full bg-bg-3" /><span className={`h-3 rounded-full bg-bg-3 ${w}`} /></div>
    return (
      <div className="rounded-xl bg-bg-1 p-2" data-cosmetic-live={value || 'none'}>
        <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Online')} — 5</div>
        {ghost('w-28')}{ghost('w-20')}
        <div className={`relative isolate flex items-center gap-3 overflow-hidden rounded-md px-2 py-1.5 ${nameplateClass(value)}`}>
          <NameplateVideo value={value} always />
          <Avatar user={{ ...user, status: 'online' }} size={32} presence />
          <span className={`min-w-0 truncate font-semibold ${look.className}`} style={{ ...look.style, textShadow: value ? '0 1px 2px rgba(0,0,0,.8)' : undefined }}><NameText look={look}>{user.display_name}</NameText></span>
        </div>
        {ghost('w-24')}{ghost('w-32')}
      </div>
    )
  }
  const draft = kind === 'effect' ? { ...user, profile_effect: value } : { ...user, profile_frame: value }
  return <div className="mx-auto w-[300px] max-w-full py-6" data-cosmetic-live={value || 'none'}><ProfileCard user={draft} /></div>
}

/** A tile in the grid: the choice drawn small, its name under it. Effects play while hovered or focused. */
function Tile({ kind, opt, user, picked, onPick, onHover, onApply }: { kind: CosmeticKind; opt: CosmeticOption | null; user: PreviewUser; picked: boolean; onPick: () => void; onHover: (on: boolean) => void; onApply: () => void }) {
  const t = useT()
  const [live, setLive] = useState(false)
  const value = opt?.value ?? ''
  const name = opt?.name ?? t('None')
  const legacy = { decoration: 'data-decoration-option', nameplate: 'data-nameplate-option', effect: opt?.group === 'folder' ? 'data-layered-option' : 'data-effect-option', frame: opt?.group === 'folder' ? 'data-layered-option' : 'data-frame-option' }[kind]
  const hover = (on: boolean) => { setLive(on); onHover(on) }
  let art: ReactNode
  if (!opt) art = <span className="flex h-full w-full items-center justify-center text-text-1"><Ban size={kind === 'nameplate' ? 20 : 28} aria-hidden /></span>
  else if (kind === 'decoration') art = <span className="flex h-full w-full items-center justify-center"><Avatar user={user} decoration={value} size={52} animate={live} /></span>
  else if (kind === 'nameplate') art = (
    <span className={`relative isolate flex h-full w-full items-center gap-2 overflow-hidden px-2.5 ${nameplateClass(value)}`}>
      {opt.group === 'folder' && <LazyVideo src={nameplateSrc(value)} />}
      <Avatar user={user} size={24} /><span className="h-2.5 flex-1 rounded-full bg-white/30" />
    </span>
  )
  else if (kind === 'effect') art = (
    <span className="relative block h-full w-full bg-[#232428]">
      {opt.thumb ? <img src={opt.thumb} alt="" loading="lazy" className={`h-full w-full object-cover object-top ${live ? 'opacity-0' : ''}`} data-layered-thumb /> : <span className="flex h-full items-center justify-center text-3xl">{opt.glyph}</span>}
      {live && <span className="absolute inset-0" data-effect-tile-live>{opt.still && <img src={opt.still} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-25" />}<ProfileEffect id={value} /></span>}
    </span>
  )
  else art = opt.thumb
    ? <img src={opt.thumb} alt="" loading="lazy" className="h-full w-full object-contain p-1" data-layered-thumb />
    : <span className="flex h-full w-full items-center justify-center p-3"><span className={`block h-full w-full rounded-lg bg-bg-3 ${frameClass(value)}`} /></span>
  const shape = kind === 'nameplate' ? 'h-12' : kind === 'decoration' ? 'aspect-square' : kind === 'effect' ? 'aspect-[3/4]' : 'aspect-[4/5]'
  return (
    <button type="button" onClick={onPick} onDoubleClick={onApply} aria-pressed={picked} title={opt?.description ? `${name}: ${opt.description}` : name}
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} onFocus={() => hover(true)} onBlur={() => hover(false)}
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-bg-0/60 text-left ${picked ? 'border-accent ring-2 ring-accent/50' : 'border-line hover:border-text-2'}`}
      data-cosmetic-option={value || 'none'} {...{ [legacy]: value || 'none' }}>
      <span className={`block w-full ${shape}`}>{art}</span>
      <span className="truncate px-1.5 py-1 text-[11px] font-semibold text-text-1" data-cosmetic-option-name>{name}</span>
    </button>
  )
}

const TITLES = { decoration: 'Change Avatar Decoration', nameplate: 'Change Nameplate', effect: 'Change Profile Effect', frame: 'Change Profile Frame' } as const

/**
 * Discord's "Change Avatar Decoration" (and nameplate, profile effect, profile frame): a searchable grid on the left
 * (None, the built-in ones, then this server's collection, drawn more as you scroll), and on the right how the choice
 * looks where people will see it, its name and description. Hovering a tile previews it; clicking picks it; Apply (or
 * a double click) hands it to the profile editor, whose Save keeps it. Cancel or Escape changes nothing.
 */
export default function CosmeticPicker({ kind, value, user, onApply, onClose, section }: { kind: CosmeticKind; value: string; user: PreviewUser; onApply: (v: string) => void; onClose: () => void; section?: string }) {
  const t = useT()
  const { builtin, folder } = useCosmeticOptions(kind)
  const [picked, setPicked] = useState(value)
  const [hover, setHover] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const needle = q.trim().toLowerCase()
  const filtering = !!needle || tag !== null
  const match = (o: CosmeticOption) => (tag === null || !!o.tags?.includes(tag)) && matchesSearch(needle, [o.name, o.description], o.tags)
  const shownBuiltin = builtin.filter(match)
  const shownFolder = useMemo(() => (folder ?? []).filter(match), [folder, needle, tag]) // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => tagCounts(folder ?? []), [folder])
  // Draw far enough to show the one already picked, so opening the picker can scroll to it.
  const at = filtering ? 0 : shownFolder.findIndex((o) => o.value === value) + 1
  const { visible, more, sentinel } = useLazySlice(shownFolder, { step: kind === 'nameplate' ? 30 : 48, key: `${needle}|${tag}`, root: scroller, atLeast: at })
  useEffect(() => { scroller.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' }) }, [folder === null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const all = [...builtin, ...(folder ?? [])]
  const shown = hover ?? picked
  const info = all.find((o) => o.value === shown)
  const apply = (v = picked) => { onApply(v); onClose() }
  const cols = kind === 'nameplate' ? 'grid-cols-1 sm:grid-cols-2' : kind === 'decoration' ? 'grid-cols-[repeat(auto-fill,minmax(92px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]'
  const tile = (o: CosmeticOption | null) => <Tile key={o?.value ?? 'none'} kind={kind} opt={o} user={user} picked={picked === (o?.value ?? '')} onPick={() => setPicked(o?.value ?? '')} onApply={() => apply(o?.value ?? '')} onHover={(on) => setHover((h) => (on ? o?.value ?? '' : h === (o?.value ?? '') ? null : h))} />
  const heading = (label: string, n: number) => <h3 className="col-span-full mt-3 text-[13px] font-bold text-text-0 first:mt-0">{label} <span className="font-normal text-text-2">{n}</span></h3>
  const total = builtin.length + (folder?.length ?? 0)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal aria-label={t(TITLES[kind])} className="pop flex h-[min(780px,100%)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-bg-1 shadow-2xl phone:h-full phone:rounded-none phone:border-0" style={{ paddingTop: 'var(--sat)' }} data-cosmetic-picker={kind} data-editor-panel={section ?? kind}>
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 truncate text-xl font-bold">{t(TITLES[kind])}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0" aria-label={t('Close')} data-editor-panel-close><X size={20} /></button>
        </div>
        <div className="flex min-h-0 flex-1 gap-5 px-5 pb-4 phone:flex-col-reverse phone:gap-3 phone:px-3">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative mb-2">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" aria-hidden />
              <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search {n}', { n: total })} aria-label={t('Search')} data-cosmetic-search />
            </div>
            <div className="mb-2"><TagFilter tags={tags} active={tag} onPick={setTag} /></div>
            {/* The scroll box wraps the grid: a grid that scrolls itself squeezes its rows once they overflow. */}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1" data-cosmetic-scroll>
            <div className={`grid auto-rows-max content-start gap-2 ${cols}`} onMouseLeave={() => setHover(null)} data-cosmetic-grid>
              {!filtering && tile(null)}
              {shownBuiltin.length > 0 && heading(t('Built in'), shownBuiltin.length)}
              {shownBuiltin.map(tile)}
              {folder === null && <p className="col-span-full py-3 text-sm text-text-2">{t('Loading…')}</p>}
              {shownFolder.length > 0 && heading(t('From this server'), shownFolder.length)}
              {visible.map(tile)}
              {more && <div ref={sentinel} className="col-span-full h-10" aria-hidden data-cosmetic-more />}
              {folder !== null && filtering && !shownBuiltin.length && !shownFolder.length && <p className="col-span-full py-6 text-center text-sm text-text-2" data-cosmetic-nothing>{needle ? t('Nothing matches “{q}”.', { q }) : t('Nothing has that tag.')}</p>}
            </div>
            </div>
          </div>
          <aside className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain phone:max-h-[42%] phone:w-full" aria-live="polite">
            <div className="rounded-xl bg-bg-0/50 p-2" data-cosmetic-preview-pane>
              <CosmeticPreview kind={kind} value={shown} user={user} />
            </div>
            <div className="rounded-xl border border-line p-3" data-cosmetic-info>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold" data-cosmetic-info-name>{info?.name ?? t('None')}</span>
                {hover !== null && hover !== picked && <span className="shrink-0 rounded bg-bg-3 px-1.5 text-[10px] font-bold uppercase text-text-2">{t('Preview')}</span>}
                {shown === value && <span className="shrink-0 rounded bg-accent/20 px-1.5 text-[10px] font-bold uppercase text-accent">{t('Current')}</span>}
              </div>
              <p className="mt-1 text-xs text-text-2">{info ? info.description || (info.group === 'folder' ? t('From this server\'s collection.') : t('Built into Parley.')) : t('Nothing on your profile.')}</p>
              {!!info?.tags?.length && (
                <div className="mt-2 flex flex-wrap gap-1" data-cosmetic-info-tags>
                  {info.tags.map((x) => <button key={x} type="button" onClick={() => setTag(x)} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1 hover:text-text-0" title={t('Show everything tagged #{tag}', { tag: x })}>#{x}</button>)}
                </div>
              )}
            </div>
          </aside>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-0/40 px-5 pt-3" style={{ paddingBottom: 'max(0.75rem, var(--sab))' }}>
          <span className="mr-auto text-xs text-text-2 phone:hidden">{t('Double-click to apply. Save your profile to keep it.')}</span>
          <button type="button" className="btn-ghost" onClick={onClose} data-cosmetic-cancel>{t('Cancel')}</button>
          <button type="button" className="btn-primary" onClick={() => apply()} disabled={picked === value} data-cosmetic-apply>{t('Apply')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
