import { Check, Clapperboard, Filter, Gamepad2, Heart, Layers, Leaf, Moon, PawPrint, Pizza, Rocket, Search, Shirt, Sparkles, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { LazyVideo, nameplateSrc } from '../components/Nameplate'
import ProfileCard from '../components/ProfileCard'
import { CosmeticPreview, tagCounts } from '../components/profile/CosmeticPicker'
import { api } from '../lib/api'
import { assetFile } from '../lib/assetCatalog'
import type { CosmeticKind } from '../lib/cosmetics'
import {
  COLORS, FIELD, KINDS, NO_FILTERS, groupVariants, labelOf, matches, sortItems, useExplore, wearPatch,
  type ExploreBundle, type ExploreCatalog, type ExploreItem, type Filters, type Group, type Sort,
} from '../lib/explore'
import { useT } from '../lib/i18n'
import type { PrivateUser } from '../lib/types'
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

/** An item drawn small: a decoration around your own avatar, a nameplate behind your name, an effect's or frame's picture. */
function Art({ item, me, live = false }: { item: ExploreItem; me: PrivateUser; live?: boolean }) {
  const id = item.value.slice('asset:'.length)
  if (item.kind === 'decoration') return <span className="flex h-full w-full items-center justify-center"><Avatar user={me} decoration={item.value} size={72} animate={live} /></span>
  if (item.kind === 'nameplate') return (
    <span className="flex h-full w-full items-center px-3">
      <span className="relative isolate flex h-11 w-full items-center gap-2 overflow-hidden rounded-md bg-bg-1 px-2.5">
        <LazyVideo src={nameplateSrc(item.value)} />
        <Avatar user={me} size={26} /><span className="truncate text-sm font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">{me.display_name || me.username}</span>
      </span>
    </span>
  )
  const src = item.kind === 'frame' ? `/api/assets/profile-frames/${encodeURIComponent(id)}/preview` : item.thumb ? assetFile('profile-effects', id, item.thumb) : null
  return src ? <img src={src} alt="" loading="lazy" className={`h-full w-full ${item.kind === 'frame' ? 'object-contain p-2' : 'object-cover object-top'}`} /> : <span className="flex h-full items-center justify-center text-text-2"><Sparkles /></span>
}

const wearing = (me: PrivateUser, it: { kind: CosmeticKind; value: string }) => (me[FIELD[it.kind]] ?? '') === it.value

function ItemCard({ group, me, onOpen }: { group: Group; me: PrivateUser; onOpen: () => void }) {
  const t = useT()
  const [live, setLive] = useState(false)
  const first = group.items[0]
  const worn = group.items.some((it) => wearing(me, it))
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setLive(true)} onMouseLeave={() => setLive(false)} onFocus={() => setLive(true)} onBlur={() => setLive(false)}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-bg-1 text-left transition hover:-translate-y-0.5 hover:border-text-2 hover:shadow-lg"
      data-style-card={first.value} data-style-kind={group.kind}>
      <span className={`relative block w-full bg-bg-0/60 ${group.kind === 'nameplate' ? 'h-24' : 'aspect-square'}`}>
        <Art item={first} me={me} live={live} />
        {worn && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-white" data-style-wearing><Check size={11} /> {t('Wearing')}</span>}
        {group.items.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white" data-style-variants={group.items.length}>{t('{n} styles', { n: group.items.length })}</span>}
      </span>
      <span className="px-3 pb-3 pt-2">
        <span className="block truncate text-sm font-semibold text-text-0" data-style-card-name>{group.name}</span>
        <span className="block truncate text-xs text-text-2">{t(ONE_KIND[group.kind])}</span>
      </span>
    </button>
  )
}

/** A bundle drawn as a set: each of its items small, side by side. */
function SetStrip({ bundle, byValue, me }: { bundle: ExploreBundle; byValue: Map<string, ExploreItem>; me: PrivateUser }) {
  const items = bundle.items.map((x) => byValue.get(`${x.kind}|${x.value}`)).filter((x): x is ExploreItem => !!x).slice(0, 4)
  return (
    <span className="grid h-full w-full grid-cols-2 gap-1 p-1">
      {items.map((it) => <span key={it.kind + it.value} className="relative overflow-hidden rounded-md bg-bg-0/70"><Art item={it} me={me} /></span>)}
    </span>
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
                    <span className={`block ${v.kind === 'nameplate' ? 'h-14' : 'aspect-square'}`}><Art item={v} me={me} /></span>
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
          {(collection || !!it.themes?.length || !!it.colors?.length || !!it.tags?.length) && (
            <section className="flex flex-wrap gap-1.5">
              {collection && <button type="button" onClick={() => { onFilter({ collection: collection.id }); onClose() }} className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/25" data-style-see-collection>{t('Collection: {name}', { name: collection.name })}</button>}
              {it.themes?.map((c) => <button key={c} type="button" onClick={() => { onFilter({ themes: [c] }); onClose() }} className="rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0">{t(labelOf(catalog.labels, c))}</button>)}
              {it.colors?.map((c) => <button key={c} type="button" onClick={() => { onFilter({ colors: [c] }); onClose() }} className="flex items-center gap-1 rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0"><span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: COLORS.find((x) => x.code === c)?.hex ?? '#888' }} />{t(labelOf(catalog.labels, c))}</button>)}
              {it.tags?.map((x) => <button key={x} type="button" onClick={() => { onFilter({ q: `#${x}` }); onClose() }} className="rounded-full bg-bg-3 px-2.5 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0" data-style-tag={x}>#{x}</button>)}
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
                <span className={`relative shrink-0 overflow-hidden rounded-md bg-bg-0/60 ${it.kind === 'nameplate' ? 'h-12 w-28' : 'h-14 w-14'}`}><Art item={it} me={me} /></span>
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
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-text-1 hover:text-text-0" {...testid}>
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={on} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  )
}

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
  const [showFilters, setShowFilters] = useState(() => typeof window === 'undefined' || window.innerWidth > 760)
  const [open, setOpen] = useState<{ group: Group; value?: string } | null>(null)
  const [openBundle, setOpenBundle] = useState<string | null>(null)
  const patch = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }))
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const items = catalog?.items ?? []
  const byValue = useMemo(() => new Map(items.map((it) => [`${it.kind}|${it.value}`, it])), [items])
  const kindTab = KINDS.includes(tab as CosmeticKind) ? (tab as CosmeticKind) : null
  const scope = useMemo(() => (kindTab ? items.filter((it) => it.kind === kindTab) : items), [items, kindTab])
  const shownItems = useMemo(() => sortItems(scope.filter((it) => matches(it, kindTab ? { ...f, kinds: [] } : f)), sort), [scope, f, sort, kindTab])
  const groups = useMemo(() => groupVariants(shownItems), [shownItems])
  const colorsHere = COLORS.filter((c) => scope.some((it) => it.colors?.includes(c.code)))
  const themesHere = useMemo(() => [...new Set(scope.flatMap((it) => it.themes ?? []))], [scope])
  const tagsHere = useMemo(() => tagCounts(scope).slice(0, 16), [scope])
  const bundles = useMemo(() => (catalog?.bundles ?? []).filter((b) => !f.q.trim() || b.name.toLowerCase().includes(f.q.trim().toLowerCase()) || b.items.some((x) => { const it = byValue.get(`${x.kind}|${x.value}`); return !!it && matches(it, { ...NO_FILTERS, q: f.q }) })), [catalog, f.q, byValue])
  const collections = catalog?.collections ?? []
  const { visible, more, sentinel } = useLazySlice(groups, { step: 60, key: `${tab}|${JSON.stringify(f)}|${sort}` })
  const filtered = JSON.stringify({ ...f, q: '' }) !== JSON.stringify({ ...NO_FILTERS, q: '' })
  const collection = collections.find((c) => c.id === f.collection)
  if (!me) return null

  const title = tab === 'all' ? t('Everything') : tab === 'bundles' ? t('Bundles') : tab === 'collections' ? t('Collections') : t(KIND_LABEL[tab])
  const count = tab === 'bundles' ? bundles.length : tab === 'collections' ? collections.length : shownItems.length
  const openItem = (it: ExploreItem) => { const g = groupVariants(items.filter((x) => x.kind === it.kind && (it.base_name ? x.base_name === it.base_name : x.value === it.value)))[0]; setOpenBundle(null); setOpen({ group: g, value: it.value }) }
  const filterFrom = (p: Partial<Filters>) => { setF({ ...NO_FILTERS, ...p }); if (tab === 'bundles' || tab === 'collections') setTab('all') }

  return (
    <div className="min-h-full flex flex-col" data-style-page>
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg-2/95 px-4 backdrop-blur phone:px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} data-style-tab={x.id}
              className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-semibold ${tab === x.id ? 'border-text-0 text-text-0' : 'border-transparent text-text-1 hover:text-text-0'}`}>{t(x.label)}</button>
          ))}
        </div>
        <div className="relative w-56 shrink-0 phone:w-36">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" aria-hidden />
          <input className="input h-9 pl-8" value={f.q} onChange={(e) => patch({ q: e.target.value })} placeholder={t('Search or #tag')} aria-label={t('Search')} data-style-search />
        </div>
      </div>
      <div className="flex flex-1 gap-6 p-6 phone:flex-col phone:gap-3 phone:p-3">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-2xl font-bold text-text-0">{title} <span className="font-normal text-text-2" data-style-count={count}>({count})</span></h1>
            {tab !== 'bundles' && tab !== 'collections' && (
              <label className="flex items-center gap-2 text-sm text-text-1">{t('Sort by')}
                <select className="input h-9 w-auto py-0" value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-style-sort>
                  <option value="popular">{t('Popular')}</option><option value="newest">{t('Newest')}</option><option value="az">{t('A–Z')}</option>
                </select>
              </label>
            )}
            <button type="button" className="btn-ghost flex items-center gap-1.5 text-sm" onClick={() => setShowFilters((s) => !s)} aria-pressed={showFilters} data-style-toggle-filters><Filter size={15} />{showFilters ? t('Hide filters') : t('Show filters')}</button>
          </div>
          {collection && (
            <div className="mb-3 flex flex-wrap gap-2">
              { <button type="button" onClick={() => patch({ collection: null })} className="flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent" data-style-collection-chip>{t('Collection: {name}', { name: collection.name })} <X size={12} /></button>}
            </div>
          )}
          {error && <p className="py-10 text-center text-sm text-red-400">{error}</p>}
          {!catalog && !error && <p className="py-10 text-center text-sm text-text-2">{t('Loading…')}</p>}
          {catalog && !items.length && <p className="py-16 text-center text-sm text-text-2" data-style-empty>{t('This server has nothing for profiles yet. Its admins can add decorations, nameplates, effects and frames in the Admin Console.')}</p>}
          {catalog && items.length > 0 && tab === 'bundles' && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {bundles.map((b) => (
                <button key={b.id} type="button" onClick={() => setOpenBundle(b.id)} className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-1 text-left transition hover:-translate-y-0.5 hover:border-text-2" data-style-bundle={b.id}>
                  <span className="block aspect-square w-full bg-bg-0/60"><SetStrip bundle={b} byValue={byValue} me={me} /></span>
                  <span className="px-3 pb-3 pt-2"><span className="block truncate text-sm font-semibold">{b.name}</span><span className="text-xs text-text-2">{(b.items.length === 1 ? t('1 item') : t('{n} items', { n: b.items.length }))}</span></span>
                </button>
              ))}
              {!bundles.length && <p className="col-span-full py-10 text-center text-sm text-text-2">{t('No sets yet.')}</p>}
            </div>
          )}
          {catalog && items.length > 0 && tab === 'collections' && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {collections.map((c) => {
                const some = items.filter((it) => it.collection_id === c.id).slice(0, 4)
                return (
                  <button key={c.id} type="button" onClick={() => filterFrom({ collection: c.id })} className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-1 text-left transition hover:-translate-y-0.5 hover:border-text-2" data-style-collection={c.id}>
                    <span className="grid aspect-square w-full grid-cols-2 gap-1 bg-bg-0/60 p-1">{some.map((it) => <span key={it.kind + it.value} className="relative overflow-hidden rounded-md bg-bg-0/70"><Art item={it} me={me} /></span>)}</span>
                    <span className="px-3 pb-3 pt-2"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="text-xs text-text-2">{(c.count === 1 ? t('1 item') : t('{n} items', { n: c.count }))}</span></span>
                  </button>
                )
              })}
              {!collections.length && <p className="col-span-full py-10 text-center text-sm text-text-2">{t('No collections yet.')}</p>}
            </div>
          )}
          {catalog && items.length > 0 && tab !== 'bundles' && tab !== 'collections' && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 phone:grid-cols-2 phone:gap-2" data-style-grid>
              {visible.map((g) => <ItemCard key={g.key} group={g} me={me} onOpen={() => setOpen({ group: g })} />)}
              {more && <div ref={sentinel} className="col-span-full h-10" aria-hidden />}
              {!groups.length && <p className="col-span-full py-10 text-center text-sm text-text-2" data-style-nothing>{t('Nothing matches these filters.')}</p>}
            </div>
          )}
        </div>
        {showFilters && tab !== 'bundles' && tab !== 'collections' && (
          <aside className="w-64 shrink-0 space-y-5 phone:order-first phone:w-full" data-style-filters>
            {tab === 'all' && (
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-text-2">{t('Item type')}</h3>
                {KINDS.map((k) => <Check1 key={k} on={f.kinds.includes(k)} onChange={() => patch({ kinds: toggle(f.kinds, k) as CosmeticKind[] })} testid={{ 'data-style-filter-kind': k }}>{t(KIND_LABEL[k])}</Check1>)}
              </section>
            )}
            {(collections.length > 0 || (catalog?.bundles.length ?? 0) > 0) && (
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-text-2">{t('Show only')}</h3>
                {collections.length > 0 && <Check1 on={f.inCollection} onChange={(on) => patch({ inCollection: on })} testid={{ 'data-style-filter-only': 'collection' }}>{t('Part of a collection')}</Check1>}
                {(catalog?.bundles.length ?? 0) > 0 && <Check1 on={f.inBundle} onChange={(on) => patch({ inBundle: on })} testid={{ 'data-style-filter-only': 'bundle' }}>{t('Part of a set')}</Check1>}
              </section>
            )}
            {colorsHere.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-2">{t('Colour')}</h3>
                <div className="flex flex-wrap gap-2">
                  {colorsHere.map((c) => {
                    const on = f.colors.includes(c.code)
                    return <button key={c.code} type="button" onClick={() => patch({ colors: toggle(f.colors, c.code) })} aria-pressed={on} title={t(labelOf(catalog?.labels ?? {}, c.code))} aria-label={t(labelOf(catalog?.labels ?? {}, c.code))}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${on ? 'border-accent ring-2 ring-accent/40' : 'border-white/15 hover:border-white/40'}`} style={{ background: c.hex }} data-style-filter-color={c.code}>{on && <Check size={14} className={c.code === 'white' || c.code === 'yellow' ? 'text-black' : 'text-white'} />}</button>
                  })}
                </div>
              </section>
            )}
            {themesHere.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-2">{t('Theme')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {themesHere.map((c) => {
                    const on = f.themes.includes(c)
                    const Icon = THEME_ICON[c] ?? Sparkles
                    return <button key={c} type="button" onClick={() => patch({ themes: toggle(f.themes, c) })} aria-pressed={on}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${on ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-style-filter-theme={c}><Icon size={13} />{t(labelOf(catalog?.labels ?? {}, c))}</button>
                  })}
                </div>
              </section>
            )}
            {tagsHere.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-2">{t('Tags')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {tagsHere.map(([x]) => <button key={x} type="button" onClick={() => patch({ q: f.q === `#${x}` ? '' : `#${x}` })} aria-pressed={f.q === `#${x}`}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${f.q === `#${x}` ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-style-filter-tag={x}>#{x}</button>)}
                </div>
              </section>
            )}
            <button type="button" className="text-sm font-semibold text-accent hover:underline disabled:text-text-2 disabled:no-underline" disabled={!filtered && !f.q} onClick={() => setF(NO_FILTERS)} data-style-clear>{t('Clear all filters')}</button>
          </aside>
        )}
      </div>
      {open && catalog && <ItemDialog key={open.group.key + (open.value ?? '')} group={open.group} initial={open.value} catalog={catalog} me={me} onClose={() => setOpen(null)} onFilter={filterFrom} />}
      {openBundle && catalog && (() => { const b = catalog.bundles.find((x) => x.id === openBundle); return b ? <BundleDialog bundle={b} byValue={byValue} me={me} onClose={() => setOpenBundle(null)} onOpenItem={openItem} /> : null })()}
    </div>
  )
}
