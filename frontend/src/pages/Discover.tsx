import { BadgeCheck, Check, ChevronDown, Compass, Search, Server, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import SplitLayout, { useShowContent } from '../components/SplitLayout'
import { MobileBack } from '../components/HeaderBits'
import { api } from '../lib/api'
import { CATEGORIES, categoryLabel, type Listing } from '../lib/discover'
import { colorFor, initials } from '../lib/format'
import type { Channel, Guild } from '../lib/types'
import { useStore } from '../store'

/** Discord's Discover: browse approved servers by category, search, and join with one click. Admins also get a review queue. */
export default function DiscoverPage() {
  const isAdmin = useStore((s) => !!s.user?.is_admin)
  // /discover/review is routed to this page separately (the preview route owns /discover/:guildId).
  const isReview = !!useMatch('/discover/review/*')
  const [pending, setPending] = useState<number | null>(null)
  useEffect(() => { if (isAdmin) api.get<Listing[]>('/admin/discovery?status=pending').then((l) => setPending(l.length)).catch(() => {}) }, [isAdmin])
  const item = (active: boolean) => `flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium ${active ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`
  const showContent = useShowContent()
  return (
    <SplitLayout defaultPane="content" testid={{ 'data-discover': '' }} sidebar={
          <aside className="w-[var(--sidebar-w)] tab:w-[224px] max-md:flex-1 shrink-0 bg-bg-1 flex flex-col">
            <div className="h-12 px-4 flex items-center font-bold text-lg border-b border-line">Discover</div>
            <nav className="p-2 space-y-0.5">
              <NavLink to="/discover" end onClick={showContent} className={({ isActive }) => item(isActive)} data-discover-servers><Server size={20} /> Servers</NavLink>
              {isAdmin && (
                <NavLink to="/discover/review" onClick={showContent} className={({ isActive }) => item(isActive)} data-discover-review>
                  <ShieldCheck size={20} /> Review Queue
                  {pending ? <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center" data-review-count>{pending}</span> : null}
                </NavLink>
              )}
            </nav>
          </aside>
    }>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isReview && isAdmin ? <ReviewQueue onChange={(n) => setPending(n)} /> : <Browse />}
      </div>
    </SplitLayout>
  )
}

function Browse() {
  const [category, setCategory] = useState<string>('home')
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [list, setList] = useState<Listing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    setList(null); setError(null)
    const params = new URLSearchParams()
    if (category !== 'home') params.set('category', category)
    if (term) params.set('q', term)
    api.get<Listing[]>(`/discover?${params}`).then(setList).catch((e: Error) => { setError(e.message); setList([]) })
  }, [category, term])
  const tabs = useMemo(() => [{ id: 'home', label: 'Home' }, ...CATEGORIES.filter((c) => c.id !== 'community'), { id: 'community', label: 'Community' }], [])

  const tabCls = (active: boolean) => `px-2.5 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${active ? 'text-text-0 border-text-0' : 'text-text-1 border-transparent hover:text-text-0'}`
  // Priority nav: measure every tab, then on each bar resize decide how many fit.
  // The search box collapses to an icon before any tab is moved into "More".
  const barRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(tabs.length)
  const [searchCompact, setSearchCompact] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const searchExpanded = !searchCompact || searchOpen || q.length > 0
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchOpen) searchRef.current?.focus() }, [searchOpen])
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    // Measure natural tab widths with throwaway elements on <body>: anything kept inside the bar
    // (even fixed, since backdrop-blur makes the bar a containing block) widens its scroll extent.
    const measure = (labels: string[]) => {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;white-space:nowrap;display:flex'
      labels.forEach((l) => { const el = document.createElement('span'); el.className = tabCls(false); el.textContent = l; host.appendChild(el) })
      document.body.appendChild(host)
      const ws = Array.from(host.children).map((n) => (n as HTMLElement).offsetWidth + 2)
      host.remove()
      return ws
    }
    const layout = () => {
      const all = measure([...tabs.map((t) => t.label), 'More ▾'])
      const widths = all.slice(0, -1)
      const more = all[all.length - 1]
      const fixed = 22 + 8 + 32 // compass + its margin + bar padding slack
      const total = bar.clientWidth - fixed
      const fit = (searchW: number) => {
        let used = 0, n = 0
        for (const w of widths) { if (used + w > total - searchW) break; used += w; n++ }
        return n
      }
      const full = 232 + 8, icon = 36 + 8
      if (fit(full) === widths.length) { setSearchCompact(false); setVisibleCount(widths.length); return }
      setSearchCompact(true)
      const searchW = searchOpen || q.length > 0 ? full : icon
      if (fit(searchW) === widths.length) { setVisibleCount(widths.length); return }
      // Leave room for the More button.
      let used = 0, n = 0
      for (const w of widths) { if (used + w > total - searchW - more) break; used += w; n++ }
      setVisibleCount(Math.max(0, n))
    }
    layout()
    document.fonts?.ready.then(layout)
    const ro = new ResizeObserver(layout); ro.observe(bar)
    window.addEventListener('resize', layout)
    return () => { ro.disconnect(); window.removeEventListener('resize', layout) }
  }, [tabs, searchOpen, q])
  const shown = tabs.slice(0, visibleCount), hidden = tabs.slice(visibleCount)
  const activeHidden = hidden.some((t) => t.id === category)

  return (
    <div className="min-h-full flex flex-col">
      <div ref={barRef} className="sticky top-0 z-10 h-14 shrink-0 flex items-center px-4 max-md:px-2 bg-bg-2/95 backdrop-blur border-b border-line" data-discover-tabs data-nav-mode={hidden.length ? 'more' : searchCompact ? 'compact' : 'full'}>
        <MobileBack />
        <Compass size={22} className="text-text-2 mr-2 shrink-0 max-md:hidden" />
        {/* Offscreen copy used only for measuring natural tab widths. */}
        <div className="flex-1 min-w-0 flex items-center gap-0.5 h-full" data-tab-strip>
          {shown.map((t) => <button key={t.id} type="button" onClick={() => setCategory(t.id)} data-discover-tab={t.id} className={tabCls(category === t.id)}>{t.label}</button>)}
          {hidden.length > 0 && (
            <div className="relative h-full flex items-center">
              <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-haspopup="menu" aria-expanded={moreOpen} data-discover-more className={`${tabCls(activeHidden)} flex items-center gap-1`}>
                More <ChevronDown size={14} className={`transition ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />
                  <div role="menu" className="pop absolute left-0 top-full mt-1 z-30 min-w-[180px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5" data-discover-more-menu>
                    {hidden.map((t) => (
                      <button key={t.id} type="button" role="menuitem" onClick={() => { setCategory(t.id); setMoreOpen(false) }} data-discover-tab={t.id} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-left ${category === t.id ? 'bg-accent text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'}`}>{t.label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="ml-2 relative shrink-0" data-search-mode={searchExpanded ? 'expanded' : 'icon'}>
          {searchExpanded ? (
            <>
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (!q) setSearchOpen(false) }} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setSearchOpen(false) } }} placeholder="Search" data-discover-search className="h-8 w-[232px] rounded-md bg-bg-0 border border-line pl-8 pr-2 text-sm outline-none focus:border-accent/60" />
            </>
          ) : (
            <button type="button" onClick={() => setSearchOpen(true)} title="Search" data-discover-search-button className="h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><Search size={18} /></button>
          )}
        </div>
      </div>
      <div className="relative overflow-hidden px-10 py-16 max-md:px-5 max-md:py-10" style={{ background: 'linear-gradient(110deg, #1b1f6b 0%, #2a2f9b 45%, #1a3a8a 100%)' }} data-discover-hero>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 20% 90%, rgba(120,180,255,0.4), transparent 45%)' }} />
        <h1 className="relative text-4xl max-md:text-2xl font-black uppercase tracking-tight leading-[1.05] text-white max-w-[640px]">Find your community on Parley</h1>
        <p className="relative mt-3 text-white/80">From gaming, to music, to learning, there's a place for you.</p>
      </div>
      <div className="px-10 py-8 max-md:px-5">
        <h2 className="text-xl font-bold mb-4">{term ? `Results for "${term}"` : category === 'home' ? 'Featured Servers' : `${categoryLabel(category)} Servers`}</h2>
        {error && <p className="text-sm text-danger">{error}</p>}
        {list === null && <p className="text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-line p-10 text-center text-text-2" data-discover-empty>
            <Compass size={32} className="mx-auto mb-2" />
            <div className="font-semibold text-text-1">No servers here yet</div>
            <div className="text-sm mt-1">Servers appear once their owners submit them from Server Settings → Discovery and a Parley admin approves.</div>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
          {list?.map((l) => <ServerCard key={l.guild_id} l={l} />)}
        </div>
      </div>
    </div>
  )
}

/** Listing card: banner, overlapping icon, verified name, description, online/member counts. Click joins (or opens if joined). */
function ServerCard({ l }: { l: Listing }) {
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const joined = useStore((s) => l.joined || !!s.guilds[l.guild_id])
  const [busy, setBusy] = useState(false)
  // Members open the server; everyone else gets Discord's preview mode (read-only, with a Join bar).
  const open = () => navigate(joined ? `/channels/${l.guild_id}` : `/discover/${l.guild_id}`)
  const quickJoin = async (e: React.MouseEvent) => {
    e.stopPropagation(); setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>(`/discover/${l.guild_id}/join`, {})
      upsertGuild(g); pushToast(`Welcome to ${g.name}!`); navigate(`/channels/${g.id}`)
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }} data-server-card={l.guild_id} className="group text-left rounded-xl bg-bg-1 border border-line hover:border-text-2 hover:-translate-y-0.5 transition overflow-visible flex flex-col cursor-pointer">
      <div className="relative h-[140px] rounded-t-xl bg-cover bg-center" style={l.banner_url ? { backgroundImage: `url(${l.banner_url})` } : { background: `linear-gradient(135deg, ${colorFor(l.guild_id)}, #1a1b23)` }}>
        {l.featured_order !== null && <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow" data-featured>Featured</span>}
        <span className="absolute left-3 -bottom-6 h-12 w-12 rounded-2xl ring-4 ring-bg-1 overflow-hidden flex items-center justify-center text-white font-bold" style={{ background: l.icon_url ? undefined : colorFor(l.guild_id) }}>
          {l.icon_url ? <img src={l.icon_url} alt="" className="h-full w-full object-cover" /> : initials(l.name)}
        </span>
      </div>
      <div className="px-3 pt-8 pb-3 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 font-bold text-[15px]">{l.verified && <span title="Verified by this instance's admins" className="flex shrink-0" data-verified><BadgeCheck size={16} className="text-success" /></span>}<span className="truncate">{l.name}</span>
          {joined ? <span className="ml-auto rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold text-text-1" data-joined>JOINED</span>
            : <button type="button" onClick={quickJoin} disabled={busy} className="ml-auto rounded-md bg-success text-black px-2 py-0.5 text-[11px] font-bold opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-success/80" data-quick-join>{busy ? 'Joining…' : 'Join'}</button>}
        </div>
        <p className="mt-1 text-sm text-text-1 line-clamp-3 flex-1">{l.description}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-text-2">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />{l.online_count.toLocaleString()} Online</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-text-2" />{l.member_count.toLocaleString()} Members</span>
        </div>
      </div>
    </div>
  )
}

/** Admin: pending submissions with Approve / Reject (optional note), plus tabs for the other states. */
function ReviewQueue({ onChange }: { onChange: (pending: number) => void }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [list, setList] = useState<Listing[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const pushToast = useStore((s) => s.pushToast)
  const load = useMemo(() => () => api.get<Listing[]>(`/admin/discovery?status=${status}`).then((l) => { setList(l); if (status === 'pending') onChange(l.length) }).catch(() => setList([])), [status, onChange])
  useEffect(() => { setList(null); load() }, [load])
  const decide = async (l: Listing, next: 'approved' | 'rejected' | 'pending') => {
    try { await api.post(`/admin/discovery/${l.guild_id}/review`, { status: next, note: notes[l.guild_id] ?? '' }); pushToast(`${l.name} ${next}`); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const flag = async (l: Listing, patch: { featured_order?: number | null; verified?: boolean }) => {
    try { await api.patch(`/admin/discovery/${l.guild_id}`, patch); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="px-10 py-8 max-md:px-4" data-review-queue>
      <div className="flex items-center gap-2"><MobileBack /><h1 className="text-2xl font-bold">Discovery review</h1></div>
      <p className="text-sm text-text-2 mt-1">Servers submitted for Discover. Approved servers are public to everyone on this Parley instance.</p>
      <div className="mt-4 flex gap-1 border-b border-line">
        {(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} data-review-tab={s} className={`px-3 py-2 text-sm font-semibold capitalize border-b-2 -mb-px ${status === s ? 'text-text-0 border-text-0' : 'text-text-1 border-transparent hover:text-text-0'}`}>{s}</button>)}
      </div>
      <div className="mt-4 space-y-3">
        {list === null && <p className="text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && <p className="text-sm text-text-2 py-6">Nothing {status} right now.</p>}
        {list?.map((l) => (
          <div key={l.guild_id} className="rounded-xl border border-line bg-bg-1 p-4 flex gap-4 max-md:flex-col" data-review-item={l.guild_id}>
            <div className="h-20 w-32 shrink-0 rounded-lg bg-cover bg-center" style={l.banner_url ? { backgroundImage: `url(${l.banner_url})` } : { background: `linear-gradient(135deg, ${colorFor(l.guild_id)}, #1a1b23)` }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-bold">{l.name}<span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold uppercase text-text-1">{categoryLabel(l.category)}</span><span className="text-xs font-normal text-text-2">{l.member_count} members</span></div>
              <p className="text-sm text-text-1 mt-1">{l.description}</p>
              <p className="text-xs text-text-2 mt-1">Submitted {new Date(l.submitted_at).toLocaleString()}{l.note ? ` · Note: ${l.note}` : ''}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <input value={notes[l.guild_id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [l.guild_id]: e.target.value }))} placeholder="Note to the server owner (optional)" maxLength={500} data-review-note className="input py-1.5 text-sm flex-1 min-w-[200px]" />
                {status !== 'approved' && <button type="button" onClick={() => decide(l, 'approved')} className="btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-approve><Check size={16} /> Approve</button>}
                {status !== 'rejected' && <button type="button" onClick={() => decide(l, 'rejected')} className="btn-danger py-1.5" data-reject><X size={16} /> Reject</button>}
                {status !== 'pending' && <button type="button" onClick={() => decide(l, 'pending')} className="btn-ghost py-1.5">Back to pending</button>}
              </div>
              {status === 'approved' && (
                <div className="mt-3 flex items-center gap-4 flex-wrap text-sm" data-review-flags>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={l.verified} onChange={(e) => flag(l, { verified: e.target.checked })} className="h-4 w-4 accent-accent" data-review-verified /> Verified badge</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={l.featured_order !== null} onChange={(e) => flag(l, { featured_order: e.target.checked ? 0 : null })} className="h-4 w-4 accent-accent" data-review-featured /> Featured</label>
                  {l.featured_order !== null && <label className="flex items-center gap-2">order <input type="number" min={0} max={1000} defaultValue={l.featured_order} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== l.featured_order) flag(l, { featured_order: n }) }} className="input w-20 py-1 text-xs" data-review-featured-order /></label>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
