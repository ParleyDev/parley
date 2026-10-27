import { useState } from 'react'
import ProfileEffect from '../ProfileEffect'
import { useT } from '../../lib/i18n'
import { assetFile, useCatalog, type LayeredItem, type LayeredKind } from '../../lib/assetCatalog'

/** The picture shown for a catalogue entry: an effect's still, or a frame's composed preview. */
export const layeredThumb = (kind: LayeredKind, item: LayeredItem) =>
  kind === 'profile-frames' ? `/api/assets/profile-frames/${encodeURIComponent(item.id)}/preview` : item.still ? assetFile(kind, item.id, item.still) : null

/**
 * Profile editor: the instance's profile effects or frames (assets folder), searchable by name and description,
 * as a grid of previews that load as they scroll in. Hovering (or focusing) an effect plays it; the description
 * shows in the tooltip.
 */
export default function LayeredPicker({ kind, value, onPick }: { kind: LayeredKind; value: string; onPick: (v: string) => void }) {
  const t = useT()
  const list = useCatalog(kind)
  const [q, setQ] = useState('')
  // The tile under the pointer (or focused) plays its effect, so you can see it before picking it.
  const [live, setLive] = useState<string | null>(null)
  if (!list || list.length === 0) return null
  const needle = q.trim().toLowerCase()
  const shown = list.filter((x) => !needle || x.name.toLowerCase().includes(needle) || x.description.toLowerCase().includes(needle))
  const frames = kind === 'profile-frames'
  return (
    <div className="mt-3 space-y-2" data-layered-picker={kind} data-layered-count={list.length}>
      <input className="input h-8 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={frames ? t('Search {n} frames', { n: list.length }) : t('Search {n} effects', { n: list.length })} data-layered-search />
      <div className={`grid ${frames ? 'grid-cols-4' : 'grid-cols-4'} gap-2 max-h-[46vh] overflow-y-auto pr-1`}>
        {shown.map((x) => {
          const v = `asset:${x.id}`
          const src = layeredThumb(kind, x)
          return (
            <button key={x.id} type="button" onClick={() => onPick(v)} aria-pressed={value === v}
              onMouseEnter={frames ? undefined : () => setLive(v)} onMouseLeave={frames ? undefined : () => setLive((c) => (c === v ? null : c))}
              onFocus={frames ? undefined : () => setLive(v)} onBlur={frames ? undefined : () => setLive((c) => (c === v ? null : c))} title={x.description ? `${x.name}: ${x.description}` : x.name}
              className={`group relative overflow-hidden rounded-lg border bg-[#232428] text-left ${value === v ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-text-2'}`} data-layered-option={v}>
              <span className={`block ${frames ? 'aspect-[4/5]' : 'aspect-[9/16]'} w-full`}>
                {src && <img src={src} alt="" loading="lazy" className={`h-full w-full transition-opacity ${frames ? 'object-contain' : 'object-cover object-top'} ${live === v ? 'opacity-25' : ''}`} />}
              </span>
              {live === v && <span className="absolute inset-0" data-effect-tile-live><ProfileEffect id={v} /></span>}
              <span className="absolute z-10 inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[11px] font-semibold leading-tight text-white line-clamp-2">{x.name}</span>
            </button>
          )
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-text-2">{t('Nothing matches.')}</p>}
    </div>
  )
}
