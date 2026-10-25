import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ASSET_PREFIX, useAssetDecorations } from '../../../lib/decorations'
import Avatar from '../../Avatar'

const PAGE = 60

/**
 * The server's image decorations (its assets folder) as a searchable grid under the preset frames. Tiles show the
 * still frame and play on hover; nothing renders when the server has none. Long catalogs page in by PAGE.
 */
export default function DecorationGallery({ user, value, onChange }: { user: { id: string; display_name: string; avatar_url: string | null }; value: string; onChange: (v: string) => void }) {
  const all = useAssetDecorations()
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const matches = useMemo(() => { const n = q.trim().toLowerCase(); return (all ?? []).filter((d) => !n || d.name.toLowerCase().includes(n) || d.id.includes(n)) }, [all, q])
  if (!all?.length) return null
  // Keep the saved one visible even when it sits beyond the first page.
  const page = matches.slice(0, shown)
  const current = matches.find((d) => ASSET_PREFIX + d.id === value)
  if (current && !page.includes(current)) page.unshift(current)
  return (
    <div className="mt-3" data-decoration-gallery>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input className="input pl-8 py-1.5 text-sm" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} placeholder={`Search ${all.length} decorations`} data-decoration-search />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-2 max-h-72 overflow-y-auto p-1" data-decoration-grid>
        {page.map((d) => {
          const v = ASSET_PREFIX + d.id
          return (
            <button key={d.id} type="button" onClick={() => onChange(v)} title={d.name} aria-label={d.name} aria-pressed={value === v} data-decoration-option={v}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 ${value === v ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`}>
              <span className="p-1.5"><Avatar user={user} decoration={v} size={40} /></span>
              <span className="w-full truncate text-center text-[11px] text-text-2">{d.name}</span>
            </button>
          )
        })}
        {!matches.length && <p className="col-span-full py-4 text-center text-sm text-text-2">No decorations match “{q}”.</p>}
      </div>
      {matches.length > shown && <button type="button" className="btn-ghost mt-2 w-full py-1.5 text-sm" onClick={() => setShown((n) => n + PAGE)} data-decoration-more>Show more ({matches.length - shown} left)</button>}
    </div>
  )
}
