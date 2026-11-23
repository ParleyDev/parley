import { Check, ChevronDown, Clapperboard, Gamepad2, Heart, Layers, Leaf, Moon, PawPrint, Pizza, Rocket, Search, Shirt, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { MobileBack } from '../components/HeaderBits'
import { LogoMark } from '../components/Logo'
import { LazyVideo, nameplateSrc } from '../components/Nameplate'
import ProfileCard from '../components/ProfileCard'
import { CosmeticPreview, tagCounts } from '../components/profile/CosmeticPicker'
import { api } from '../lib/api'
import { assetFile } from '../lib/assetCatalog'
import { decorationUrl } from '../lib/decorations'
import type { CosmeticKind } from '../lib/cosmetics'
import {
  COLORS, FIELD, KINDS, NO_FILTERS, groupVariants, labelOf, matches, plainTags, sortItems, useExplore, wearPatch,
  type ExploreBundle, type ExploreCatalog, type ExploreItem, type Filters, type Group, type Sort,
} from '../lib/explore'
import { useT } from '../lib/i18n'
import type { PrivateUser } from '../lib/types'
import { usePhone } from '../lib/swipe'
import { useLazySlice } from '../lib/useLazySlice'
import { useStore } from '../store'

type Tab = 'all' | CosmeticKind | 'bundles' | 'collections'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'decoration', label: 'Avatar Decorations' }, { id: 'nameplate', label: 'Nameplates' },
  { id: 'effect', label: 'Profile Effects' }, { id: 'frame', label: 'Profile Frames' }, { id: 'bundles', label: 'Bundles' }, { id: 'collections', label: 'Collections' },
]
const KIND_LABEL: Record<CosmeticKind, string> = { decoration: 'Avatar Decorations', nameplate: 'Nameplates', effect: 'Profile Effects', frame: 'Profile Frames' }
const ONE_KIND: Record<CosmeticKind, string> = { decoration: 'Avatar decoration', nameplate: 'Nameplate', effect: 'Profile effect', frame: 'Profile frame' }
const THEME_ICON: Record<string, typeof Heart> = {
  anime: Sparkles, gaming: Gamepad2, cute_cozy: Heart, sci_fi: Rocket, food_drinks: Pizza, fantasy: Wand2,
  animals_pets: PawPrint, nature: Leaf, movies_tv: Clapperboard, dark_moody: Moon,
}

/** Wear these on your profile at once (the same save as the profile editor's). */
async function wear(patch: Record<string, string>, done: string) {
  const st = useStore.getState()
  try {
    const worn = await api.patch<Partial<PrivateUser>>('/users/@me/cosmetics', patch)
    if (st.token && st.user) st.setAuth(st.token, { ...st.user, ...worn })
    st.pushToast(done)
  } catch (e) { st.pushToast((e as Error).message, 'error') }
}

const hoverless = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

/** A stand-in avatar for the cards: a grey disc with the Parley mark (the cards show the item, not you). */
function Blank({ className = '' }: { className?: string }) {
  return <span className={`flex aspect-square items-center justify-center rounded-full bg-[#5c5f6a] text-white/45 ${className}`}><LogoMark className="w-1/2" /></span>
}
/** Skeleton lines and boxes, the shop's way of drawing "a profile" without anyone's details. */
const Bar = ({ className = '' }: { className?: string }) => <span className={`block rounded-full bg-text-2/25 ${className}`} />

/** A decoration around a stand-in avatar; it plays while `live`. */
function DecorationArt({ value, live, className = '' }: { value: string; live: boolean; className?: string }) {
  const id = value.slice('asset:'.length)
  return (
    <span className={`relative block aspect-square ${className}`}>
      <Blank className="h-full w-full" />
      <img src={decorationUrl(id, !live)} alt="" draggable={false} loading="lazy" className="pointer-events-none absolute left-[-10%] top-[-10%] h-[120%] w-[120%] max-w-none select-none" />
    </span>
  )
}

/** A nameplate behind a member-list row (its video plays while the row is hovered; an animated picture on touch screens). */
function PlateStrip({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`relative isolate flex items-center gap-[4cqw] overflow-hidden rounded-[2cqw] bg-bg-1 px-[3cqw] ${className}`}>
      {hoverless() ? <img src={`${nameplateSrc(value)}/anim`} alt="" loading="lazy" className="np-fit pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-none" /> : <LazyVideo src={nameplateSrc(value)} />}
      <Blank className="h-[60%] shrink-0" /><Bar className="h-[18%] w-[45%] bg-white/30" />
    </span>
  )
}

/** A blank profile card (banner, avatar, lines) with an effect over it or a frame around it. */
function CardArt({ effect, frame }: { effect?: ExploreItem; frame?: ExploreItem }) {
  const fx = effect?.thumb ? assetFile('profile-effects', effect.value.slice('asset:'.length), effect.thumb) : null
  return (
    <span className="absolute inset-0 overflow-hidden">
      {frame
        ? <img src={`/api/assets/profile-frames/${encodeURIComponent(frame.value.slice('asset:'.length))}/preview`} alt="" loading="lazy" className="absolute left-[14%] top-[5%] w-[72%] max-w-none" />
        : (
          <span className="absolute inset-x-[8%] top-[7%] bottom-0 overflow-hidden rounded-t-[4cqw] bg-text-2/10">
            <span className="absolute left-[9%] top-[16%] w-[26%]"><Blank className="w-full" /></span>
            <Bar className="absolute left-[9%] top-[48%] h-[4%] w-[40%]" /><Bar className="absolute left-[9%] top-[57%] h-[4%] w-[62%]" />
          </span>
        )}
      {fx && <img src={fx} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover object-top" />}
    </span>
  )
}

/** An item drawn to fill a card (or any `@container` box): what it looks like on a profile, on blank stand-ins. */
function Art({ item, live = false }: { item: ExploreItem; live?: boolean }) {
  if (item.kind === 'decoration') return <span className="absolute inset-0 flex items-start justify-center pt-[13%]"><DecorationArt value={item.value} live={live} className="w-[50%]" /></span>
  if (item.kind === 'nameplate') return (
    <span className="absolute inset-x-[6%] top-[5%] flex flex-col gap-[4cqw]">
      <span className="flex h-[17cqw] items-center gap-[4cqw] px-[3cqw] opacity-40"><Blank className="h-[60%]" /><Bar className="h-[3.5cqw] w-[45%]" /></span>
      <PlateStrip value={item.value} className="h-[17cqw]" />
      <span className="flex h-[17cqw] items-center gap-[4cqw] px-[3cqw] opacity-40"><Blank className="h-[60%]" /><Bar className="h-[3.5cqw] w-[45%]" /></span>
    </span>
  )
  return item.kind === 'frame' ? <CardArt frame={item} /> : <CardArt effect={item} />
}

/** A set drawn together: your avatar with its decoration, the nameplate on a tilted row, the card with its effect or frame. */
function SetArt({ items, live = false }: { items: ExploreItem[]; live?: boolean }) {
  const of = (k: CosmeticKind) => items.find((x) => x.kind === k)
  const dec = of('decoration'), plate = of('nameplate'), fx = of('effect'), fr = of('frame')
  const card = fx || fr
  if (!card) return (
    <span className="absolute inset-0">
      {dec && <span className="absolute left-1/2 top-[10%] w-[44%] -translate-x-1/2"><DecorationArt value={dec.value} live={live} className="w-full" /></span>}
      {plate && <PlateStrip value={plate.value} className={`absolute left-[8%] h-[17cqw] w-[84%] shadow-lg ${dec ? 'top-[60%]' : 'top-[40%]'}`} />}
    </span>
  )
  if (!dec && !plate) return <CardArt effect={fx} frame={fr} />
  return (
    <span className="absolute inset-0">
      <span className="absolute -right-[8%] top-[4%] h-[104%] w-[56%] rotate-[7deg] overflow-hidden rounded-[3cqw] bg-bg-4 shadow-xl ring-1 ring-black/30 @container"><CardArt effect={fx} frame={fr} /></span>
      {dec && <span className="absolute left-[6%] top-[7%] w-[40%]"><DecorationArt value={dec.value} live={live} className="w-full" /></span>}
      {plate && <PlateStrip value={plate.value} className="absolute -left-[4%] top-[57%] h-[18cqw] w-[64%] -rotate-[8deg] shadow-lg" />}
    </span>
  )
}

const wearing = (me: PrivateUser, it: { kind: CosmeticKind; value: string }) => (me[FIELD[it.kind]] ?? '') === it.value

/** A card in the grid: the art fills it, the name sits on a shade at the bottom. */
function Tile({ name, sub, worn, onOpen, data, children }: { name: string; sub?: string; worn?: boolean; onOpen: () => void; data: Record<string, string | number>; children: (live: boolean) => ReactNode }) {
  const t = useT()
  const [live, setLive] = useState(false)
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setLive(true)} onMouseLeave={() => setLive(false)} onFocus={() => setLive(true)} onBlur={() => setLive(false)}
      className="@container group relative block aspect-[50/49] w-full overflow-hidden rounded-lg border border-white/[.06] bg-gradient-to-b from-bg-3 to-bg-4 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-accent" {...data}>
      {children(live)}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 px-3.5 pb-3 phone:px-2.5 phone:pb-2">
        <span className="block truncate text-[15px] font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.6)] phone:text-sm" data-style-card-name>{name}</span>
        {sub && <span className="block truncate text-xs font-semibold text-white/70">{sub}</span>}
      </span>
      {worn && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow" data-style-wearing><Check size={11} /> {t('Wearing')}</span>}
    </button>
  )
}

function ItemCard({ group, me, onOpen }: { group: Group; me: PrivateUser; onOpen: () => void }) {
  const t = useT()
  const first = group.items[0]
  return (
    <Tile name={group.name} sub={group.items.length > 1 ? t('{n} styles', { n: group.items.length }) : undefined} worn={group.items.some((it) => wearing(me, it))} onOpen={onOpen}
      data={{ 'data-style-card': first.value, 'data-style-kind': group.kind, ...(group.items.length > 1 ? { 'data-style-variants': group.items.length } : {}) }}>
      {(live) => <Art item={first} live={live} />}
    </Tile>
  )
}

/** Your profile wearing a whole set: the card (decoration, effect, frame) and a member-list row (nameplate). */
function SetPreview({ items, me }: { items: { kind: CosmeticKind; value: string }[]; me: PrivateUser }) {
  const draft = { ...me, ...wearPatch(items) }
  const plate = items.find((x) => x.kind === 'nameplate')
  return (
    <div className="space-y-3" data-style-set-preview>
      <div className="mx-auto w-[300px] max-w-full"><ProfileCard user={draft} /></div>
      {plate && <CosmeticPreview kind="nameplate" value={plate.value} user={draft} />}
    </div>
  )
}

function Modal({ label, onClose, children, testid }: { label: string; onClose: () => void; children: ReactNode; testid: string }) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm phone:p-0" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Full screen on phones: below the status bar, with the close button in its own bar rather than over the preview. */}
      <div role="dialog" aria-modal aria-label={label} className="pop relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-bg-1 shadow-2xl phone:h-full phone:rounded-none phone:border-0 phone:pt-[var(--sat)] phone:pb-[var(--sab)]" {...{ [testid]: '' }}>
        <div className="phone:flex phone:shrink-0 phone:items-center phone:justify-end phone:border-b phone:border-line phone:px-2 phone:py-1">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0 phone:static phone:p-2.5" aria-label={t('Close')} data-style-close><X size={22} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 phone:p-3">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

function ItemDialog({ group, initial, catalog, me, onClose, onFilter }: { group: Group; initial?: string; catalog: ExploreCatalog; me: PrivateUser; onClose: () => void; onFilter: (f: Partial<Filters>) => void }) {
  const t = useT()
  const [idx, setIdx] = useState(() => { const at = group.items.findIndex((it) => it.value === initial); return at >= 0 ? at : Math.max(0, group.items.findIndex((it) => wearing(me, it))) })
  const [trying, setTrying] = useState<string | null>(null)
  const it = group.items[idx] ?? group.items[0]
  const bundles = catalog.bundles.filter((b) => it.bundles?.includes(b.id))
  const collection = catalog.collections.find((c) => c.id === it.collection_id)
  const tried = bundles.find((b) => b.id === trying)
  const worn = wearing(me, it)
  return (
    <Modal label={it.name} onClose={onClose} testid="data-style-dialog">
      <div className="flex gap-5 phone:flex-col">
        <div className="w-[380px] shrink-0 phone:w-full" data-style-preview={tried ? `set:${tried.id}` : it.value}>
          {tried ? <SetPreview items={tried.items} me={me} /> : <CosmeticPreview kind={it.kind} value={it.value} user={me} />}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="pr-8">
            <div className="text-xs font-bold uppercase tracking-wide text-text-2">{t(ONE_KIND[it.kind])}</div>
            <h2 className="text-xl font-bold text-text-0" data-style-dialog-name>{it.name}</h2>
            {it.variant_label && <div className="text-sm text-text-1">{it.variant_label}</div>}
            {it.description && <p className="mt-2 text-sm text-text-1">{it.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {worn
              ? <button type="button" className="btn-ghost" onClick={() => void wear({ [FIELD[it.kind]]: '' }, t('Taken off your profile.'))} data-style-take-off>{t('Take it off')}</button>
              : <button type="button" className="btn-primary" onClick={() => void wear({ [FIELD[it.kind]]: it.value }, t('Now on your profile.'))} data-style-wear><Shirt size={16} className="mr-1.5 inline" />{t('Wear it')}</button>}
          </div>
          {group.items.length > 1 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-text-2">{t('Styles')}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
                {group.items.map((v, i) => (
                  <button key={v.value} type="button" onClick={() => { setIdx(i); setTrying(null) }} aria-pressed={i === idx} title={v.variant_label ?? v.name}
                    className={`overflow-hidden rounded-lg border bg-bg-0/60 ${i === idx ? 'border-accent ring-2 ring-accent/50' : 'border-line hover:border-text-2'}`} data-style-variant={v.value}>
                    <span className="@container relative block aspect-square bg-gradient-to-b from-bg-3 to-bg-4"><Art item={v} /></span>
                    <span className="block truncate px-1 py-0.5 text-[11px] text-text-1">{v.variant_label ?? v.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {bundles.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-text-2">{t('In these sets')}</h3>
              <div className="space-y-2">
                {bundles.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2" data-style-item-bundle={b.id}>
                    <Layers size={16} className="shrink-0 text-text-2" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{b.name}</span><span className="text-xs text-text-2">{(b.items.length === 1 ? t('1 item') : t('{n} items', { n: b.items.length }))}</span></span>
                    <button type="button" className="btn-ghost text-sm" aria-pressed={trying === b.id} onClick={() => setTrying(trying === b.id ? null : b.id)} data-style-try-set>{trying === b.id ? t('Stop trying') : t('Try the set')}</button>
                    <button type="button" className="btn-primary text-sm" onClick={() => void wear(wearPatch(b.items), t('The whole set is on your profile.'))} data-style-wear-set>{t('Wear all')}</button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {(collection || !!it.themes?.length || !!it.colors?.length || plainTags(it.tags).length > 0) && (
            <section className="flex flex-wrap gap-1.5">
              {collection && <button type="button" onClick={() => { onFilter({ collection: collection.id }); onClose() }} className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/25" data-style-see-collection>{t('Collection: {name}', { name: collection.name })}</button>}
              {it.themes?.map((c) => <button key={c} type="button" onClick={() => { onFilter({ themes: [c] }); onClose() }} className="rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0">{t(labelOf(catalog.labels, c))}</button>)}
              {it.colors?.map((c) => <button key={c} type="button" onClick={() => { onFilter({ colors: [c] }); onClose() }} className="flex items-center gap-1 rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0"><span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: COLORS.find((x) => x.code === c)?.hex ?? '#888' }} />{t(labelOf(catalog.labels, c))}</button>)}
              {plainTags(it.tags).map((x) => <button key={x} type="button" onClick={() => { onFilter({ q: `#${x}` }); onClose() }} className="rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0" data-style-tag={x}>#{x}</button>)}
            </section>
          )}
        </div>
      </div>
    </Modal>
  )
}

function BundleDialog({ bundle, byValue, me, onClose, onOpenItem }: { bundle: ExploreBundle; byValue: Map<string, ExploreItem>; me: PrivateUser; onClose: () => void; onOpenItem: (it: ExploreItem) => void }) {
  const t = useT()
  const items = bundle.items.map((x) => byValue.get(`${x.kind}|${x.value}`)).filter((x): x is ExploreItem => !!x)
  return (
    <Modal label={bundle.name} onClose={onClose} testid="data-style-bundle-dialog">
      <div className="flex gap-5 phone:flex-col">
        <div className="w-[380px] shrink-0 phone:w-full"><SetPreview items={bundle.items} me={me} /></div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="pr-8">
            <div className="text-xs font-bold uppercase tracking-wide text-text-2">{t('Set')}</div>
            <h2 className="text-xl font-bold text-text-0">{bundle.name}</h2>
          </div>
          <button type="button" className="btn-primary" onClick={() => void wear(wearPatch(bundle.items), t('The whole set is on your profile.'))} data-style-wear-set>{t('Wear all')}</button>
          <div className="space-y-2">
            {items.map((it) => (
              <button key={it.kind + it.value} type="button" onClick={() => onOpenItem(it)} className="flex w-full items-center gap-3 rounded-lg border border-line p-2 text-left hover:border-text-2" data-style-bundle-item={it.value}>
                <span className="@container relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gradient-to-b from-bg-3 to-bg-4"><Art item={it} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{it.name}</span><span className="text-xs text-text-2">{t(ONE_KIND[it.kind])}</span></span>
                {wearing(me, it) && <Check size={16} className="text-accent" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Check1({ on, onChange, children, testid }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; testid?: Record<string, string> }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1.5 text-[15px] text-text-1 hover:text-text-0" {...testid}>
      <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? 'border-accent bg-accent text-white' : 'border-text-2/70'}`} aria-hidden>{on && <Check size={14} strokeWidth={3} />}</span>
      <span className={on ? 'text-text-0' : ''}>{children}</span>
    </label>
  )
}

const Heading = ({ children }: { children: ReactNode }) => <h3 className="mb-2 text-[15px] font-semibold text-text-0">{children}</h3>

/** Discover → Profile Style: browse and try on everything this server has for profiles, and wear it in a click. */
export default function ProfileStyle() {
  const t = useT()
  const me = useStore((s) => s.user)
  const { catalog, error } = useExplore()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((x) => x.id === params.get('tab')) ? params.get('tab') : 'all') as Tab
  const setTab = (id: Tab) => setParams((p) => { const n = new URLSearchParams(p); if (id === 'all') n.delete('tab'); else n.set('tab', id); return n }, { replace: true })
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>('popular')
  const phone = usePhone()
  const [showFilters, setShowFilters] = useState(() => typeof window === 'undefined' || window.innerWidth > 760)
  const [open, setOpen] = useState<{ group: Group; value?: string } | null>(null)
  const [openBundle, setOpenBundle] = useState<string | null>(null)
  const patch = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }))
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const items = catalog?.items ?? []
  const byValue = useMemo(() => new Map(items.map((it) => [`${it.kind}|${it.value}`, it])), [items])
  const kindTab = KINDS.includes(tab as CosmeticKind) ? (tab as CosmeticKind) : null
  const sets = tab === 'bundles' || tab === 'collections'
  const scope = useMemo(() => (kindTab ? items.filter((it) => it.kind === kindTab) : items), [items, kindTab])
  const shownItems = useMemo(() => sortItems(scope.filter((it) => matches(it, kindTab ? { ...f, kinds: [] } : f)), sort), [scope, f, sort, kindTab])
  const groups = useMemo(() => groupVariants(shownItems), [shownItems])
  const colorsHere = COLORS.filter((c) => scope.some((it) => it.colors?.includes(c.code)))
  // Colours without a swatch (a `color:` tag can name any): listed by name after the swatches, so none is lost.
  const otherColors = useMemo(() => [...new Set(scope.flatMap((it) => it.colors ?? []))].filter((c) => !COLORS.some((x) => x.code === c)).sort(), [scope])
  const themesHere = useMemo(() => [...new Set(scope.flatMap((it) => it.themes ?? []))], [scope])
  const tagsHere = useMemo(() => tagCounts(scope.map((it) => ({ tags: plainTags(it.tags) }))).slice(0, 16), [scope])
  // Sets and collections show when one of their items passes the filters (kind and "part of" aside).
  const itemFilter = useMemo(() => ({ ...f, kinds: [], inBundle: false, inCollection: false, collection: null }), [f])
  const setItems = (list: { kind: CosmeticKind; value: string }[]) => list.map((x) => byValue.get(`${x.kind}|${x.value}`)).filter((x): x is ExploreItem => !!x)
  const bundles = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const list = (catalog?.bundles ?? []).map((b) => ({ b, its: setItems(b.items) }))
      .filter(({ b, its }) => (f.inCollection ? !!b.collection_id || its.some((x) => x.collection_id) : true) && ((q && !q.startsWith('#') && b.name.toLowerCase().includes(q)) || its.some((it) => matches(it, itemFilter))))
    const rank = (its: ExploreItem[]) => Math.min(...its.map((x) => x.rank ?? Infinity))
    const added = (its: ExploreItem[]) => Math.max(0, ...its.map((x) => x.added))
    return list.sort((x, y) => sort === 'az' ? x.b.name.localeCompare(y.b.name) : sort === 'newest' ? added(y.its) - added(x.its) || x.b.name.localeCompare(y.b.name) : rank(x.its) - rank(y.its) || x.b.name.localeCompare(y.b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, f, itemFilter, byValue, sort])
  const collections = catalog?.collections ?? []
  const shownCollections = useMemo(() => collections.map((c) => ({ c, its: items.filter((it) => it.collection_id === c.id) })).filter(({ c, its }) => (f.q.trim() && !f.q.trim().startsWith('#') && c.name.toLowerCase().includes(f.q.trim().toLowerCase())) || its.some((it) => matches(it, itemFilter))), [collections, items, itemFilter, f.q])
  const lazyList = tab === 'bundles' ? bundles : tab === 'collections' ? shownCollections : groups
  const { visible, more, sentinel } = useLazySlice<unknown>(lazyList, { step: 60, key: `${tab}|${JSON.stringify(f)}|${sort}` })
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS)
  const collection = collections.find((c) => c.id === f.collection)
  if (!me) return null

  const title = tab === 'all' ? (f.kinds.length === 1 ? t(KIND_LABEL[f.kinds[0]]) : t('Everything')) : tab === 'bundles' ? t('Bundles') : tab === 'collections' ? t('Collections') : t(KIND_LABEL[tab])
  const count = tab === 'bundles' ? bundles.length : tab === 'collections' ? shownCollections.length : shownItems.length
  const openItem = (it: ExploreItem) => { const g = groupVariants(items.filter((x) => x.kind === it.kind && (it.base_name ? x.base_name === it.base_name : x.value === it.value)))[0]; setOpenBundle(null); setOpen({ group: g, value: it.value }) }
  const filterFrom = (p: Partial<Filters>) => { setF({ ...NO_FILTERS, ...p }); if (sets) setTab('all') }
  // Item Type: the four kinds can be ticked together; Bundles and Collections are views of their own.
  const kindsOn: CosmeticKind[] = kindTab ? [kindTab] : tab === 'all' ? f.kinds : []
  const pickKind = (k: CosmeticKind) => {
    const next = sets ? [k] : (toggle(kindsOn, k) as CosmeticKind[])
    if (next.length === 1) { setTab(next[0]); patch({ kinds: [] }) } else { setTab('all'); patch({ kinds: next }) }
  }
  const pickView = (v: 'bundles' | 'collections') => { setTab(tab === v ? 'all' : v); patch({ kinds: [] }) }
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5 phone:grid-cols-2 phone:gap-2.5'
  const countOf = (n: number) => (n === 1 ? t('1 item') : t('{n} items', { n }))

  const filters = (
        <aside className="sticky top-0 max-h-screen w-72 shrink-0 space-y-6 self-start overflow-y-auto border-l border-line px-5 py-6 phone:fixed phone:inset-0 phone:self-auto phone:z-40 phone:max-h-none phone:w-full phone:border-0 phone:bg-bg-2 phone:pt-[calc(var(--sat)+1rem)] phone:pb-0" data-style-filters>
          <div className="hidden items-center justify-between phone:flex">
            <span className="text-lg font-bold text-text-0">{t('Filters')}</span>
            <button type="button" onClick={() => setShowFilters(false)} className="rounded-md p-2 text-text-2 hover:bg-bg-3 hover:text-text-0" aria-label={t('Close')} data-style-filters-close><X size={22} /></button>
          </div>
          <section>
            <Heading>{t('Item type')}</Heading>
            {KINDS.map((k) => <Check1 key={k} on={kindsOn.includes(k)} onChange={() => pickKind(k)} testid={{ 'data-style-filter-kind': k }}>{t(KIND_LABEL[k])}</Check1>)}
            <Check1 on={tab === 'bundles'} onChange={() => pickView('bundles')} testid={{ 'data-style-tab': 'bundles' }}>{t('Bundles')}</Check1>
            {collections.length > 0 && <Check1 on={tab === 'collections'} onChange={() => pickView('collections')} testid={{ 'data-style-tab': 'collections' }}>{t('Collections')}</Check1>}
          </section>
          {((collections.length > 0 && tab !== 'collections') || ((catalog?.bundles.length ?? 0) > 0 && !sets)) && (
            <section>
              <Heading>{t('Show only')}</Heading>
              {collections.length > 0 && <Check1 on={f.inCollection} onChange={(on) => patch({ inCollection: on })} testid={{ 'data-style-filter-only': 'collection' }}>{t('Part of a collection')}</Check1>}
              {(catalog?.bundles.length ?? 0) > 0 && !sets && <Check1 on={f.inBundle} onChange={(on) => patch({ inBundle: on })} testid={{ 'data-style-filter-only': 'bundle' }}>{t('Part of a set')}</Check1>}
            </section>
          )}
          {(colorsHere.length > 0 || otherColors.length > 0) && (
            <section>
              <Heading>{t('Colour')}</Heading>
              <div className="grid grid-cols-5 gap-2.5 phone:flex phone:flex-wrap">
                {colorsHere.map((c) => {
                  const on = f.colors.includes(c.code)
                  return <button key={c.code} type="button" onClick={() => patch({ colors: toggle(f.colors, c.code) })} aria-pressed={on} title={t(labelOf(catalog?.labels ?? {}, c.code))} aria-label={t(labelOf(catalog?.labels ?? {}, c.code))}
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition ${on ? 'ring-2 ring-text-0 ring-offset-2 ring-offset-bg-2' : 'ring-1 ring-white/10 hover:scale-110'}`} style={{ background: c.hex }} data-style-filter-color={c.code}>{on && <Check size={16} strokeWidth={3} className={c.code === 'white' || c.code === 'yellow' ? 'text-black' : 'text-white'} />}</button>
                })}
              </div>
              {otherColors.length > 0 && (
                <div className={`flex flex-wrap gap-2 ${colorsHere.length ? 'mt-2.5' : ''}`}>
                  {otherColors.map((c) => {
                    const on = f.colors.includes(c)
                    return <button key={c} type="button" onClick={() => patch({ colors: toggle(f.colors, c) })} aria-pressed={on}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition ${on ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:border-text-2/60 hover:text-text-0'}`} data-style-filter-color={c}>
                      <span className="h-3 w-3 rounded-full border border-white/20 bg-text-2/60" aria-hidden />{t(labelOf(catalog?.labels ?? {}, c))}</button>
                  })}
                </div>
              )}
            </section>
          )}
          {themesHere.length > 0 && (
            <section>
              <Heading>{t('Theme')}</Heading>
              <div className="flex flex-wrap gap-2">
                {themesHere.map((c) => {
                  const on = f.themes.includes(c)
                  const Icon = THEME_ICON[c] ?? Sparkles
                  return <button key={c} type="button" onClick={() => patch({ themes: toggle(f.themes, c) })} aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition ${on ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:border-text-2/60 hover:text-text-0'}`} data-style-filter-theme={c}><Icon size={15} />{t(labelOf(catalog?.labels ?? {}, c))}</button>
                })}
              </div>
            </section>
          )}
          {tagsHere.length > 0 && (
            <section>
              <Heading>{t('Tags')}</Heading>
              <div className="flex flex-wrap gap-1.5">
                {tagsHere.map(([x]) => <button key={x} type="button" onClick={() => patch({ q: f.q === `#${x}` ? '' : `#${x}` })} aria-pressed={f.q === `#${x}`}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold ${f.q === `#${x}` ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:text-text-0'}`} data-style-filter-tag={x}>#{x}</button>)}
              </div>
            </section>
          )}
          <button type="button" className="h-10 w-full rounded-lg bg-bg-3 text-[15px] font-semibold text-text-0 hover:bg-bg-4 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-bg-3" disabled={!filtered} onClick={() => setF(NO_FILTERS)} data-style-clear>{t('Clear all filters')}</button>
          <div className="hidden phone:sticky phone:bottom-0 phone:-mx-5 phone:block phone:border-t phone:border-line phone:bg-bg-2 phone:px-5 phone:pb-[calc(var(--sab)+1rem)] phone:pt-3"><button type="button" className="btn-primary w-full" onClick={() => setShowFilters(false)} data-style-filters-done>{t('Show {n}', { n: count })}</button></div>
        </aside>
  )
  return (
    <div className="flex min-h-full" data-style-page>
      <div className="min-w-0 flex-1 px-8 py-6 phone:px-3 phone:py-3">
        <div className="mb-5 flex flex-wrap items-center gap-3 phone:mb-3 phone:gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-1"><MobileBack /><h1 className="truncate text-xl font-bold text-text-0">{title} <span data-style-count={count}>({count})</span></h1></div>
          <div className="relative w-60 phone:order-last phone:w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" aria-hidden />
            <input className="input h-10 rounded-lg pl-9" value={f.q} onChange={(e) => patch({ q: e.target.value })} placeholder={t('Search or #tag')} aria-label={t('Search')} data-style-search />
          </div>
          <label className="flex items-center gap-2.5 text-[15px] font-semibold text-text-0">{t('Sort by')}
            <span className="relative">
              <select className="h-10 w-48 cursor-pointer appearance-none rounded-lg border border-line bg-bg-1 pl-3 pr-9 text-[15px] font-normal text-text-0 outline-none hover:border-text-2/50 focus:border-accent phone:w-36" value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-style-sort>
                <option value="popular">{t('Popular')}</option><option value="newest">{t('Newest')}</option><option value="az">{t('A–Z')}</option>
              </select>
              <ChevronDown size={18} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-1" aria-hidden />
            </span>
          </label>
          <button type="button" className="flex h-10 items-center gap-2 rounded-lg bg-bg-3 px-4 text-[15px] font-semibold text-text-0 hover:bg-bg-4" onClick={() => setShowFilters((s) => !s)} aria-pressed={showFilters} data-style-toggle-filters>
            {showFilters ? t('Hide filters') : t('Show filters')}<SlidersHorizontal size={17} />
          </button>
        </div>
        {collection && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => patch({ collection: null })} className="flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent" data-style-collection-chip>{t('Collection: {name}', { name: collection.name })} <X size={12} /></button>
          </div>
        )}
        {error && <p className="py-10 text-center text-sm text-red-400">{error}</p>}
        {!catalog && !error && <p className="py-10 text-center text-sm text-text-2">{t('Loading…')}</p>}
        {catalog && !items.length && <p className="py-16 text-center text-sm text-text-2" data-style-empty>{t('This server has nothing for profiles yet. Its admins can add decorations, nameplates, effects and frames in the Admin Console.')}</p>}
        {catalog && items.length > 0 && (
          <div className={grid} data-style-grid>
            {tab === 'bundles' && (visible as typeof bundles).map(({ b, its }) => (
              <Tile key={b.id} name={b.name} sub={countOf(b.items.length)} worn={b.items.length > 0 && b.items.every((x) => wearing(me, x))} onOpen={() => setOpenBundle(b.id)} data={{ 'data-style-bundle': b.id }}>
                {(live) => <SetArt items={its} live={live} />}
              </Tile>
            ))}
            {tab === 'collections' && (visible as typeof shownCollections).map(({ c, its }) => (
              <Tile key={c.id} name={c.name} sub={countOf(c.count)} onOpen={() => filterFrom({ collection: c.id })} data={{ 'data-style-collection': c.id }}>
                {(live) => <SetArt items={KINDS.map((k) => its.find((x) => x.kind === k)).filter((x): x is ExploreItem => !!x)} live={live} />}
              </Tile>
            ))}
            {!sets && (visible as Group[]).map((g) => <ItemCard key={g.key} group={g} me={me} onOpen={() => setOpen({ group: g })} />)}
            {more && <div ref={sentinel} className="col-span-full h-10" aria-hidden />}
            {!lazyList.length && (
              <p className="col-span-full py-10 text-center text-sm text-text-2" data-style-nothing>
                {filtered ? t('Nothing matches these filters.') : tab === 'bundles' ? t('No sets yet.') : tab === 'collections' ? t('No collections yet.') : t('Nothing matches these filters.')}
              </p>
            )}
          </div>
        )}
      </div>
      {/* On a phone the filters are a full-screen sheet, on the body: inside the page they'd scroll away with it. */}
      {showFilters && (phone ? createPortal(filters, document.body) : filters)}
      {open && catalog && <ItemDialog key={open.group.key + (open.value ?? '')} group={open.group} initial={open.value} catalog={catalog} me={me} onClose={() => setOpen(null)} onFilter={filterFrom} />}
      {openBundle && catalog && (() => { const b = catalog.bundles.find((x) => x.id === openBundle); return b ? <BundleDialog bundle={b} byValue={byValue} me={me} onClose={() => setOpenBundle(null)} onOpenItem={openItem} /> : null })()}
    </div>
  )
}
