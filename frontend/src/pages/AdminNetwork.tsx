import { Lock, Maximize2, Minus, Plus, Search } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import CropImg from '../components/CropImg'
import { api } from '../lib/api'
import { splitCrop } from '../lib/crop'
import { Sim, type SimLink } from '../lib/forceGraph'
import { colorFor, initials } from '../lib/format'
import { useT } from '../lib/i18n'
import { globalName } from '../lib/names'
import { useStore } from '../store'
import { can, useAccess } from './adminAccess'

export interface NetUser { id: string; kind: 'user'; username: string; display_name: string; avatar_url: string | null; bot: boolean; guest?: boolean; suspended?: boolean; friends?: number; servers?: number }
export interface NetServer { id: string; kind: 'server'; name: string; icon_url: string | null; owner_id?: string; state?: string; members?: number }
interface NetGroup { id: 'loose'; kind: 'group'; count: number }
type NetNode = NetUser | NetServer | NetGroup
type EdgeKind = 'friend' | 'member' | 'owner' | 'shared'
interface NetEdge { a: string; b: string; t: EdgeKind; w?: number; since?: string }
interface Around { focus: string; nodes: NetNode[]; edges: NetEdge[]; truncated: boolean; big: number }
interface Summary { servers: NetServer[]; links: NetEdge[]; people_in_servers: number; loose: number; servers_total: number; max_people: number }
interface People { nodes: NetUser[]; edges: NetEdge[]; truncated: boolean }

/** A link to the Network view centred on a person or server. */
export const networkLink = (id: string) => `/admin/network?focus=${id}`

const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; opacity: number; dash?: string }> = {
  friend: { stroke: '#38bdf8', width: 2, opacity: 0.75 },
  owner: { stroke: 'var(--color-warn)', width: 2, opacity: 0.8 },
  member: { stroke: 'var(--color-text-2)', width: 1.2, opacity: 0.45, dash: '4 4' },
  shared: { stroke: 'var(--color-text-2)', width: 2, opacity: 0.3 },
}

function radius(n: NetNode, summary: boolean, focus?: string) {
  if (n.kind === 'group') return Math.min(70, 18 + Math.sqrt(n.count) * 4)
  if (n.kind === 'server') return summary ? Math.min(90, 16 + Math.sqrt(n.members ?? 1) * 5) : n.id === focus ? 24 : Math.min(26, 15 + Math.sqrt(n.members ?? 1))
  return n.id === focus ? 20 : 13
}
const linkOf = (e: NetEdge): SimLink => e.t === 'shared' ? { a: e.a, b: e.b, len: 240, k: 0.015 } : { a: e.a, b: e.b, len: e.t === 'friend' ? 95 : 125, k: 0.04 }

interface GraphHandle { fit(): number; zoomBy(f: number): void; centerOn(id: string, k: number): void; nearest(ids: string[]): string[] }
interface GraphProps {
  nodes: NetNode[]; edges: NetEdge[]; focus?: string; selected?: string | null; summary: boolean; label: (n: NetNode) => string
  /** A new key lays the graph out from scratch and frames it (around `center`, zoomed by `zoom`, when given). */
  frame: { key: string; center?: string; zoom?: number }
  onSelect(id: string): void; onActivate(id: string): void; onZoom(k: number): void; onFramed(fitK: number): void
}

/** The drawing: an SVG the force layout moves directly (no React render per frame), with pan, zoom and dragging. */
const Graph = forwardRef<GraphHandle, GraphProps>(function Graph(p, ref) {
  const svg = useRef<SVGSVGElement>(null), root = useRef<SVGGElement>(null)
  const sim = useRef<Sim | null>(null)
  const view = useRef({ x: 0, y: 0, k: 1 })
  const els = useRef(new Map<string, SVGGElement>())
  const lines = useRef<(SVGLineElement | null)[]>([])
  const raf = useRef(0)
  const drag = useRef<{ id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const framed = useRef('')
  const [hover, setHover] = useState<string | null>(null)
  const ids = useMemo(() => new Set(p.nodes.map((n) => n.id)), [p.nodes])
  const edges = useMemo(() => p.edges.filter((e) => ids.has(e.a) && ids.has(e.b) && e.a !== e.b), [p.edges, ids])
  const near = useMemo(() => {
    if (!hover) return null
    const s = new Set([hover])
    for (const e of edges) { if (e.a === hover) s.add(e.b); if (e.b === hover) s.add(e.a) }
    return s
  }, [hover, edges])
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const size = () => { const b = svg.current?.getBoundingClientRect(); return { w: b?.width || 800, h: b?.height || 560 } }
  const apply = () => {
    const v = view.current
    root.current?.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`)
    svg.current?.classList.toggle('net-far', v.k < 0.6)
  }
  const draw = useCallback(() => {
    const s = sim.current; if (!s) return
    for (const [id, el] of els.current) { const n = s.nodes.get(id); if (n) el.setAttribute('transform', `translate(${n.x},${n.y})`) }
    edges.forEach((e, i) => {
      const l = lines.current[i], a = s.nodes.get(e.a), b = s.nodes.get(e.b)
      if (l && a && b) { l.setAttribute('x1', String(a.x)); l.setAttribute('y1', String(a.y)); l.setAttribute('x2', String(b.x)); l.setAttribute('y2', String(b.y)) }
    })
  }, [edges])
  const run = useCallback((frames = 300) => {
    cancelAnimationFrame(raf.current)
    const s = sim.current; if (!s) return
    if (reduced) { s.settle(frames); draw(); return }
    let n = 0
    const loop = () => { s.step(); draw(); if (++n < frames || drag.current?.id) raf.current = requestAnimationFrame(loop) }
    loop()
  }, [draw, reduced])
  const fit = useCallback(() => {
    const s = sim.current; if (!s) return 1
    const { w, h } = size(), b = s.bounds()
    const k = Math.max(0.05, Math.min(1.6, w / (b.x1 - b.x0 + 80), h / (b.y1 - b.y0 + 80)))
    view.current = { k, x: w / 2 - (k * (b.x0 + b.x1)) / 2, y: h / 2 - (k * (b.y0 + b.y1)) / 2 }
    apply()
    return k
  }, [])
  const centerOn = (id: string, k: number) => {
    const n = sim.current?.nodes.get(id); if (!n) return
    const { w, h } = size()
    view.current = { k, x: w / 2 - n.x * k, y: h / 2 - n.y * k }; apply()
  }
  const zoomAt = (f: number, cx?: number, cy?: number) => {
    const b = svg.current!.getBoundingClientRect(), v = view.current
    const k = Math.max(0.05, Math.min(4, v.k * f)), px = (cx ?? b.left + b.width / 2) - b.left, py = (cy ?? b.top + b.height / 2) - b.top
    view.current = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
    apply(); p.onZoom(k)
  }
  useImperativeHandle(ref, () => ({
    fit, zoomBy: (f) => zoomAt(f), centerOn,
    nearest: (list) => {
      const s = sim.current; if (!s) return []
      const { w, h } = size(), v = view.current, cx = (w / 2 - v.x) / v.k, cy = (h / 2 - v.y) / v.k
      return list.filter((id) => s.nodes.has(id)).sort((a, b) => { const p1 = s.nodes.get(a)!, p2 = s.nodes.get(b)!; return Math.hypot(p1.x - cx, p1.y - cy) - Math.hypot(p2.x - cx, p2.y - cy) })
    },
  }))

  // New nodes or links: keep everyone where they were, start newcomers next to their server, and settle.
  useEffect(() => {
    const homes = new Map<string, string>()
    const kind = new Map(p.nodes.map((n) => [n.id, n.kind]))
    for (const e of edges) if ((e.t === 'member' || e.t === 'owner') && !homes.has(e.a)) homes.set(e.a, e.b)
    const fresh = framed.current !== p.frame.key
    const prev = fresh && !p.frame.center ? undefined : sim.current?.nodes
    sim.current = new Sim(p.nodes.map((n) => ({ id: n.id, r: radius(n, p.summary, p.focus) })), edges.map(linkOf), {
      prev, pin: p.focus, home: (id) => (kind.get(id) === 'user' ? homes.get(id) ?? (prev?.has('loose') ? 'loose' : undefined) : undefined),
    })
    if (fresh) {
      framed.current = p.frame.key
      sim.current.settle(p.nodes.length > 600 ? 120 : 220)
      draw()
      const k = fit()
      if (p.frame.center) centerOn(p.frame.center, k * (p.frame.zoom ?? 1.5))
      p.onFramed(k)
      run(120)
    } else run()
    return () => cancelAnimationFrame(raf.current)
  }, [p.nodes, edges, p.frame.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pan the background, drag nodes, zoom with the wheel or a pinch.
  useEffect(() => {
    const el = svg.current!
    const toWorld = (x: number, y: number) => { const b = el.getBoundingClientRect(), v = view.current; return { x: (x - b.left - v.x) / v.k, y: (y - b.top - v.y) / v.k } }
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 4) d.moved = true
      if (!d.moved) return
      if (d.id) { const n = sim.current?.nodes.get(d.id); if (n) { const w = toWorld(ev.clientX, ev.clientY); n.x = w.x; n.y = w.y; sim.current!.alpha = Math.max(sim.current!.alpha, 0.3) } }
      else { view.current = { ...view.current, x: d.vx + ev.clientX - d.sx, y: d.vy + ev.clientY - d.sy }; apply() }
    }
    const up = () => { const d = drag.current; if (d?.id) { const n = sim.current?.nodes.get(d.id); if (n) n.drag = false } el.classList.remove('cursor-grabbing'); setTimeout(() => { drag.current = null }, 0) }
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      const g = (ev.target as Element).closest('[data-net-node]')
      const id = g?.getAttribute('data-net-node') ?? undefined
      drag.current = { id, sx: ev.clientX, sy: ev.clientY, vx: view.current.x, vy: view.current.y, moved: false }
      if (id) { const n = sim.current?.nodes.get(id); if (n) { n.drag = true; sim.current!.alpha = 0.5; run() } } else el.classList.add('cursor-grabbing')
    }
    const wheel = (ev: WheelEvent) => { ev.preventDefault(); zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY) }
    el.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); el.addEventListener('wheel', wheel, { passive: false })
    return () => { el.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel) }
  }, [run]) // eslint-disable-line react-hooks/exhaustive-deps

  const clicked = (id: string, double: boolean) => { if (drag.current?.moved) return; if (double) p.onActivate(id); else p.onSelect(id) }
  return (
    <svg ref={svg} className="net-graph h-full w-full touch-none select-none cursor-grab" data-net-graph role="img" aria-label="Network graph">
      <defs>
        <clipPath id="net-clip-round" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5" /></clipPath>
        <clipPath id="net-clip-square" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".28" /></clipPath>
      </defs>
      <g ref={root}>
        <g>
          {edges.map((e, i) => {
            const st = EDGE_STYLE[e.t]
            const width = e.t === 'shared' ? 1 + Math.min(10, e.w ?? 1) : st.width
            const faded = near && !(near.has(e.a) && near.has(e.b) && (e.a === hover || e.b === hover))
            return <line key={`${e.a}-${e.b}-${e.t}`} ref={(l) => { lines.current[i] = l }} stroke={st.stroke} strokeWidth={width} strokeOpacity={faded ? 0.06 : st.opacity} strokeDasharray={st.dash} strokeLinecap="round" data-net-edge={e.t}>
              {e.t === 'shared' && <title>{`${e.w}`}</title>}
            </line>
          })}
        </g>
        <g>
          {p.nodes.map((n) => {
            const r = radius(n, p.summary, p.focus), focus = n.id === p.focus, sel = n.id === p.selected
            const pic = n.kind === 'user' ? n.avatar_url : n.kind === 'server' ? n.icon_url : null
            const round = n.kind !== 'server'
            return (
              <g key={n.id} ref={(g) => { if (g) els.current.set(n.id, g); else els.current.delete(n.id) }} data-net-node={n.id} data-net-kind={n.kind}
                className={`cursor-pointer transition-opacity ${near && !near.has(n.id) ? 'opacity-10' : ''} ${focus || sel || hover === n.id ? 'net-keep' : ''}`}
                tabIndex={0} role="button" aria-label={p.label(n)} aria-pressed={sel}
                onClick={() => clicked(n.id, false)} onDoubleClick={() => clicked(n.id, true)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') p.onActivate(n.id); if (ev.key === ' ') { ev.preventDefault(); p.onSelect(n.id) } }}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}>
                {round
                  ? <circle r={r + 4} fill="none" stroke="var(--color-accent)" strokeWidth={3} opacity={sel ? 1 : 0} />
                  : <rect x={-r - 4} y={-r - 4} width={2 * r + 8} height={2 * r + 8} rx={(r + 4) * 0.56} fill="none" stroke="var(--color-accent)" strokeWidth={3} opacity={sel ? 1 : 0} />}
                {n.kind === 'group'
                  ? <><circle r={r} fill="var(--color-bg-3)" stroke="var(--color-text-2)" strokeDasharray="4 3" /><text textAnchor="middle" dy=".35em" className="fill-text-0 text-[12px] font-bold pointer-events-none">{n.count}</text></>
                  : round ? <circle r={r} fill={colorFor(n.id)} /> : <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.56} fill={colorFor(n.id)} />}
                {n.kind !== 'group' && (pic
                  ? <image href={splitCrop(pic).base} x={-r} y={-r} width={2 * r} height={2 * r} preserveAspectRatio="xMidYMid slice" clipPath={`url(#net-clip-${round ? 'round' : 'square'})`} className="pointer-events-none" />
                  : <text textAnchor="middle" dy=".35em" fill="#fff" fontSize={Math.max(9, r * 0.62)} fontWeight={700} className="pointer-events-none">{initials(p.label(n))}</text>)}
                {n.kind === 'user' && n.suspended && <circle r={r + 2} fill="none" stroke="var(--color-danger)" strokeWidth={2} strokeDasharray="3 2" />}
                <text className={`net-label pointer-events-none fill-text-1 ${focus ? 'font-bold fill-text-0' : ''}`} textAnchor="middle" y={r + 14} fontSize={focus ? 12 : 11}>
                  {p.label(n)}{n.kind === 'user' && n.bot ? ' · bot' : ''}{p.summary && n.kind === 'server' ? ` · ${n.members ?? 0}` : ''}
                </text>
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
})

type Level = 'summary' | 'people'

/** /admin/network — friendships and server memberships as a graph, around one person or server, or the whole instance. */
export default function NetworkPane() {
  const t = useT()
  const a = useAccess()
  const navigate = useNavigate()
  const pushToast = useStore((s) => s.pushToast)
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus') ?? undefined
  const depth = params.get('depth') === '1' ? 1 : 2
  const bots = params.get('bots') === '1'
  const mode = focus ? 'around' : 'all'
  const [showFriends, setShowFriends] = useState(true)
  const [showMembers, setShowMembers] = useState(true)
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  const [around, setAround] = useState<Around | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [people, setPeople] = useState<People | null>(null)
  const [level, setLevel] = useState<Level>('summary')
  const [frame, setFrame] = useState<{ key: string; center?: string; zoom?: number }>({ key: 'start' })
  const [err, setErr] = useState<string | null>(null)
  const graph = useRef<GraphHandle>(null)
  const zoomBase = useRef({ summary: 1, people: 1 })
  const loadingPeople = useRef(false)
  const allowed = can(a, 'network_read')

  const label = useCallback((n: NetNode) => (n.kind === 'user' ? globalName(n) : n.kind === 'server' ? n.name : t('Not in any server')), [t])
  const set = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) { if (v === null) q.delete(k); else q.set(k, v) }
    setParams(q)
  }

  // Around one person or server.
  useEffect(() => {
    if (!allowed || !focus) return
    setErr(null)
    api.get<Around>(`/admin/network?focus=${focus}&depth=${depth}&bots=${bots}`).then((r) => {
      setAround(r); setSelected(focus); setFrame({ key: `around:${focus}:${depth}:${bots}` })
      const me = r.nodes.find((n) => n.id === focus)
      if (me) setTrail((tr) => { const i = tr.findIndex((x) => x.id === focus); return i >= 0 ? tr.slice(0, i + 1) : [...tr, { id: focus, name: label(me) }].slice(-8) })
    }).catch((e: Error) => setErr(e.message))
  }, [allowed, focus, depth, bots]) // eslint-disable-line react-hooks/exhaustive-deps

  // The whole instance, summarised.
  useEffect(() => {
    if (!allowed || focus) return
    setErr(null); setLevel('summary'); setPeople(null)
    api.get<Summary>(`/admin/network/summary?bots=${bots}`).then((r) => { setSummary(r); setFrame({ key: `summary:${bots}:${Date.now()}` }) }).catch((e: Error) => setErr(e.message))
  }, [allowed, focus, bots])

  // Zoomed in on the instance: the people in the servers you're looking at (everyone, when that fits).
  const openPeople = async (center?: string) => {
    if (!summary || loadingPeople.current) return
    loadingPeople.current = true
    try {
      const order = graph.current?.nearest(summary.servers.map((s) => s.id)) ?? []
      const target = center ?? order[0]
      let q = ''
      if (summary.people_in_servers + summary.loose > summary.max_people) {
        const pick: string[] = []; let n = 0
        for (const id of target ? [target, ...order.filter((x) => x !== target)] : order) {
          const m = summary.servers.find((s) => s.id === id)?.members ?? 0
          if (pick.length && n + m > summary.max_people) break
          pick.push(id); n += m
        }
        q = `guilds=${pick.join(',')}&`
      }
      const r = await api.get<People>(`/admin/network/people?${q}bots=${bots}`)
      setPeople(r); setLevel('people'); setSelected(target ?? null)
      setFrame({ key: `people:${Date.now()}`, center: target, zoom: 1.6 })
    } catch (e) { pushToast((e as Error).message, 'error') } finally { loadingPeople.current = false }
  }
  const toSummary = () => { setLevel('summary'); setFrame({ key: `summary:${bots}:${Date.now()}` }) }
  const onZoom = (k: number) => {
    if (mode !== 'all') return
    if (level === 'summary' && k > zoomBase.current.summary * 1.7) void openPeople()
    else if (level === 'people' && k < zoomBase.current.people * 0.8) toSummary()
  }

  // What the graph draws.
  const data = useMemo((): { nodes: NetNode[]; edges: NetEdge[] } => {
    let nodes: NetNode[] = [], edges: NetEdge[] = []
    if (mode === 'around' && around) { nodes = around.nodes; edges = around.edges }
    if (mode === 'all' && summary) {
      if (level === 'summary') {
        nodes = [...summary.servers, ...(summary.loose ? [{ id: 'loose', kind: 'group', count: summary.loose } as NetGroup] : [])]
        edges = summary.links
      } else if (people) { nodes = [...summary.servers, ...people.nodes]; edges = people.edges }
    }
    edges = edges.filter((e) => (e.t === 'friend' ? showFriends : e.t === 'shared' ? true : showMembers))
    return { nodes, edges }
  }, [mode, around, summary, people, level, showFriends, showMembers])
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const sel = selected ? byId.get(selected) : undefined
  const isSummary = mode === 'all' && level === 'summary'

  const center = (id: string) => { const n = byId.get(id); if (n?.kind === 'group') return; set({ focus: id, view: null }) }
  const activate = (id: string) => { if (isSummary) { if (byId.get(id)?.kind === 'server') void openPeople(id) } else if (mode === 'around') center(id); else setSelected(id) }
  const pickDepth = (d: '1' | '2' | 'all') => {
    if (d === 'all') { setTrail([]); set({ focus: null, depth: null }); return }
    const start = focus ?? (sel && sel.kind !== 'group' ? sel.id : summary?.servers[0]?.id)
    if (!start) return
    set({ focus: start, depth: d === '1' ? '1' : null })
  }

  if (!allowed) return <div data-admin-network-denied><h1 className="text-2xl font-bold">{t('Network')}</h1><p className="mt-2 text-sm text-text-2">{t('Only super admins can open Network.')}</p></div>

  const counts = (() => {
    if (isSummary && summary) return t('{servers} servers · {people} people in them · {loose} in none', { servers: summary.servers.length, people: summary.people_in_servers, loose: summary.loose })
    const ppl = data.nodes.filter((n) => n.kind === 'user').length
    return t('{people} people · {servers} servers · {friends} friendships', { people: ppl, servers: data.nodes.filter((n) => n.kind === 'server').length, friends: data.edges.filter((e) => e.t === 'friend').length })
  })()
  const truncated = mode === 'around' ? around?.truncated : level === 'people' ? people?.truncated : false

  return (
    <div className="flex flex-col gap-3" data-admin-network>
      <div>
        <h1 className="text-2xl font-bold">{t('Network')}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-text-2">{t('Who is friends with whom, and who is in which server. Start from a person or a server and click your way outward, or look at the whole instance.')}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-1 px-2.5 py-1 text-xs text-text-1"><Lock size={12} className="text-warn" />{t('Only super admins can open Network. Every view is recorded in the audit log.')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NetSearch onPick={(id) => { setTrail([]); set({ focus: id, view: null }) }} />
        <div className="inline-flex rounded-lg border border-line bg-bg-1 p-0.5" role="group" aria-label={t('How far out')}>
          {([['1', t('Direct')], ['2', t('2 steps')], ['all', t('Everyone')]] as const).map(([d, l]) => {
            const on = d === 'all' ? mode === 'all' : mode === 'around' && String(depth) === d
            return <button key={d} type="button" aria-pressed={on} onClick={() => pickDepth(d)} data-net-depth={d} className={`rounded-md px-2.5 py-1 text-[13px] ${on ? 'bg-accent font-semibold text-white' : 'text-text-1 hover:text-text-0'}`}>{l}</button>
          })}
        </div>
        <Chip on={showFriends} onClick={() => setShowFriends((v) => !v)} swatch="#38bdf8" testid="friend">{t('Friendships')}</Chip>
        <Chip on={showMembers} onClick={() => setShowMembers((v) => !v)} swatch="var(--color-text-2)" testid="member">{t('Memberships')}</Chip>
        <Chip on={bots} onClick={() => set({ bots: bots ? null : '1' })} testid="bots">{t('Bots')}</Chip>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1 text-[13px] text-text-2" data-net-trail>
        {mode === 'all'
          ? <span>{t('The whole instance. Zoom in, or double-click a server, to see its people; pick Direct or 2 steps to explore around one person or server.')}</span>
          : <>{t('Path:')} {trail.map((x, i) => <span key={x.id} className="inline-flex items-center gap-1">{i > 0 && <span aria-hidden>›</span>}<button type="button" onClick={() => center(x.id)} className={`rounded-full px-2.5 py-0.5 ${x.id === focus ? 'bg-accent font-semibold text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-net-crumb={x.id}>{x.name}</button></span>)}</>}
      </div>
      {err && <p className="text-sm text-danger" data-net-error>{err}</p>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative h-[calc(100dvh-430px)] min-h-[420px] overflow-hidden rounded-xl border border-line bg-bg-1 phone:h-[460px]">
          <Graph ref={graph} nodes={data.nodes} edges={data.edges} focus={mode === 'around' ? focus : undefined} selected={selected} summary={isSummary} label={label} frame={frame}
            onSelect={setSelected} onActivate={activate} onZoom={onZoom} onFramed={(k) => { zoomBase.current[isSummary ? 'summary' : 'people'] = k }} />
          <div className="pointer-events-none absolute left-2.5 right-14 top-2.5 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-bg-2/90 px-2 py-1 text-xs tabular-nums text-text-2" data-net-count>{counts}</span>
            {mode === 'all' && (
              <button type="button" onClick={() => (isSummary ? void openPeople() : toSummary())} data-net-level={level}
                className="pointer-events-auto whitespace-nowrap rounded-full border border-line bg-bg-2 px-3 py-1 text-xs text-text-1 hover:text-text-0">
                {isSummary ? <><b className="text-text-0">{t('Summary')}</b> · {t('zoom in to see people')}</> : <><b className="text-text-0">{t('People')}</b> · {t('zoom out to summarize')}</>}
              </button>
            )}
          </div>
          <div className="absolute right-2.5 top-2.5 grid gap-1">
            <ZoomBtn label={t('Zoom in')} onClick={() => graph.current?.zoomBy(1.25)}><Plus size={16} /></ZoomBtn>
            <ZoomBtn label={t('Zoom out')} onClick={() => graph.current?.zoomBy(0.8)}><Minus size={16} /></ZoomBtn>
            <ZoomBtn label={t('Fit to view')} onClick={() => { const k = graph.current?.fit(); if (k) zoomBase.current[isSummary ? 'summary' : 'people'] = k }}><Maximize2 size={14} /></ZoomBtn>
          </div>
          {truncated && <div className="absolute inset-x-0 bottom-12 mx-auto w-fit rounded-md bg-warn/15 px-2 py-1 text-xs text-warn" data-net-truncated>{t('Showing part of this network. Pick Direct, or start from someone closer, to see all of it.')}</div>}
          <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap gap-3 rounded-md border border-line bg-bg-2/90 px-2.5 py-1.5 text-xs text-text-1 phone:hidden">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-accent" />{t('Person')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] bg-text-2" />{t('Server')}</span>
            {(['friend', 'member', 'owner'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><svg width="20" height="6" aria-hidden><line x1="0" y1="3" x2="20" y2="3" stroke={EDGE_STYLE[k].stroke} strokeWidth="2" strokeDasharray={EDGE_STYLE[k].dash} /></svg>{{ friend: t('Friends'), member: t('Member'), owner: t('Owner') }[k]}</span>)}
            </div>
            <div className="ml-auto text-[11px] text-text-2 phone:hidden">{isSummary ? t('Double-click a server to see its people') : t('Click to inspect · double-click to center · drag to move')}</div>
          </div>
        </div>
        <aside className="flex max-h-[calc(100dvh-430px)] min-h-[420px] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-bg-1 p-3.5 lg:max-h-none phone:min-h-0" aria-live="polite" data-net-inspector={sel?.id ?? ''}>
          {sel ? <Inspector n={sel} data={data} byId={byId} focus={mode === 'around' ? focus : undefined} label={label} people={level === 'people' ? people : null}
            onSelect={setSelected} onCenter={center} onOpen={(n) => navigate(n.kind === 'user' ? `/admin/users/${n.id}` : `/admin/servers/${n.id}`)} canUser={can(a, 'account_metadata_read')} canServer={can(a, 'conversation_metadata_read')} />
            : <p className="text-sm text-text-2">{t('Click a person or server to see who they are connected to.')}</p>}
        </aside>
      </div>
    </div>
  )
}

function Chip({ on, onClick, swatch, children, testid }: { on: boolean; onClick: () => void; swatch?: string; children: ReactNode; testid: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-net-show={testid}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[13px] ${on ? 'border-text-2 text-text-0' : 'border-line text-text-1'} bg-bg-1`}>
      {swatch && <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: swatch, opacity: on ? 1 : 0.3 }} />}{children}
    </button>
  )
}
function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line bg-bg-2 text-text-1 hover:text-text-0">{children}</button>
}

/** A small round (person) or rounded-square (server) picture with initials as the fallback. */
export function NetAvatar({ id, name, url, server, size = 28 }: { id: string; name: string; url: string | null | undefined; server?: boolean; size?: number }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-bold text-white ${server ? 'rounded-[30%]' : 'rounded-full'}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: url ? undefined : colorFor(id) }}>
      {url ? <CropImg src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  )
}

/** The people search the Network view starts from. */
function NetSearch({ onPick }: { onPick: (id: string) => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<(NetUser | NetServer)[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const h = setTimeout(() => api.get<{ users: NetUser[]; servers: NetServer[] }>(`/admin/network/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits([...r.users, ...r.servers]); setOpen(true) }).catch(() => {}), 200)
    return () => clearTimeout(h)
  }, [q])
  useEffect(() => { const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }; addEventListener('mousedown', close); return () => removeEventListener('mousedown', close) }, [])
  const pick = (id: string) => { setQ(''); setHits([]); setOpen(false); onPick(id) }
  return (
    <div ref={box} className="relative min-w-0 flex-[1_1_240px] max-w-sm">
      <Search size={16} className="pointer-events-none absolute left-2.5 top-2.5 text-text-2" />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0].id); if (e.key === 'Escape') setOpen(false) }}
        placeholder={t('Find a person or server')} aria-label={t('Find a person or server')} className="input h-9 w-full pl-8" data-net-search />
      {open && hits.length > 0 && (
        <div className="absolute inset-x-0 top-10 z-20 max-h-72 overflow-y-auto rounded-lg border border-line bg-bg-1 p-1 shadow-2xl" data-net-results>
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => pick(h.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-3" data-net-hit={h.id}>
              <NetAvatar id={h.id} name={h.kind === 'user' ? globalName(h) : h.name} url={h.kind === 'user' ? h.avatar_url : h.icon_url} server={h.kind === 'server'} size={22} />
              <span className="truncate">{h.kind === 'user' ? globalName(h) : h.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-text-2">{h.kind === 'server' ? t('server') : `@${h.username}`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface InspectorProps {
  n: NetNode; data: { nodes: NetNode[]; edges: NetEdge[] }; byId: Map<string, NetNode>; focus?: string; label: (n: NetNode) => string; people: People | null
  onSelect(id: string): void; onCenter(id: string): void; onOpen(n: NetUser | NetServer): void; canUser: boolean; canServer: boolean
}

/** The side panel: who or what is selected, and what it is connected to in the graph. */
function Inspector({ n, data, byId, focus, label, people, onSelect, onCenter, onOpen, canUser, canServer }: InspectorProps) {
  const t = useT()
  const nb = (id: string, kinds: EdgeKind[]) => data.edges.filter((e) => kinds.includes(e.t) && (e.a === id || e.b === id)).map((e) => (e.a === id ? e.b : e.a))
  const Row = ({ id, meta }: { id: string; meta?: ReactNode }) => {
    const x = byId.get(id); if (!x || x.kind === 'group') return null
    return (
      <button type="button" onClick={() => onSelect(id)} onDoubleClick={() => onCenter(id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-3" data-net-row={id}>
        <NetAvatar id={id} name={label(x)} url={x.kind === 'user' ? x.avatar_url : x.icon_url} server={x.kind === 'server'} size={22} />
        <span className="truncate">{label(x)}</span><span className="ml-auto shrink-0 text-[11px] text-text-2">{meta}</span>
      </button>
    )
  }
  const Section = ({ title, ids, meta }: { title: string; ids: string[]; meta?: (id: string) => ReactNode }) => (
    <div><h5 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2">{title}</h5>
      {ids.length ? <div className="grid gap-0.5">{ids.map((id) => <Row key={id} id={id} meta={meta?.(id)} />)}</div> : <p className="text-xs text-text-2">{t('None shown.')}</p>}</div>
  )
  const Stat = ({ v, l }: { v: ReactNode; l: string }) => <div className="rounded-lg bg-bg-2 px-2 py-1.5"><b className="block text-lg tabular-nums">{v}</b><small className="text-[11px] text-text-2">{l}</small></div>
  const btn = 'rounded-lg px-3 py-1.5 text-[13px] font-semibold'

  if (n.kind === 'group') {
    const loose = (people?.nodes ?? []).filter((p) => (p.servers ?? 0) === 0)
    return <>
      <div className="flex items-center gap-2.5"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-3 font-bold">{n.count}</span><div><b className="block">{label(n)}</b><small className="text-text-2">{t("People who haven't joined a server")}</small></div></div>
      {loose.length ? <Section title={t('People · {n}', { n: loose.length })} ids={loose.map((p) => p.id)} /> : <p className="text-xs text-text-2">{t('Zoom in to see them.')}</p>}
    </>
  }
  if (n.kind === 'user') {
    const friends = nb(n.id, ['friend']), servers = nb(n.id, ['member', 'owner']), owned = nb(n.id, ['owner'])
    const f = focus && focus !== n.id ? byId.get(focus) : undefined
    let mutual: ReactNode = null
    if (f?.kind === 'user') {
      const ff = new Set(nb(f.id, ['friend'])), mf = friends.filter((x) => ff.has(x)), fs = new Set(nb(f.id, ['member', 'owner'])), ms = servers.filter((x) => fs.has(x))
      const edge = data.edges.find((e) => e.t === 'friend' && ((e.a === n.id && e.b === f.id) || (e.b === n.id && e.a === f.id)))
      mutual = <div className="rounded-lg bg-bg-2 px-2.5 py-2 text-xs text-text-1" data-net-mutual>
        {edge ? t('Friends with {name} since {date}.', { name: label(f), date: edge.since ? new Date(edge.since).toLocaleDateString() : '—' }) : t('Not friends with {name}.', { name: label(f) })}{' '}
        {t('{friends} mutual friends, {servers} shared servers.', { friends: mf.length, servers: ms.length })}
      </div>
    }
    return <>
      <div className="flex items-center gap-2.5"><NetAvatar id={n.id} name={label(n)} url={n.avatar_url} size={44} /><div className="min-w-0"><b className="block truncate">{label(n)}</b><small className="text-text-2">@{n.username}</small></div></div>
      {(n.bot || n.suspended || n.guest) && <div className="flex flex-wrap gap-1">
        {n.bot && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">{t('BOT')}</span>}
        {n.guest && <span className="rounded bg-text-2/20 px-1.5 py-0.5 text-[10px] font-bold text-text-1">{t('GUEST')}</span>}
        {n.suspended && <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger">{t('SUSPENDED')}</span>}
      </div>}
      <div className="grid grid-cols-3 gap-2"><Stat v={n.friends ?? friends.length} l={t('friends')} /><Stat v={n.servers ?? servers.length} l={t('servers')} /><Stat v={owned.length} l={t('owned')} /></div>
      {mutual}
      <div className="flex flex-wrap gap-1.5">
        {focus && focus !== n.id && <button type="button" className={`${btn} bg-accent text-white`} onClick={() => onCenter(n.id)} data-net-center>{t('Center on them')}</button>}
        {canUser && <button type="button" className={`${btn} bg-bg-3 font-medium text-text-0`} onClick={() => onOpen(n)} data-net-open>{t('Open user details')}</button>}
      </div>
      <Section title={(n.friends ?? 0) > friends.length ? t('Friends · {shown} of {n} shown', { shown: friends.length, n: n.friends ?? 0 }) : t('Friends · {n}', { n: friends.length })} ids={friends} />
      <Section title={(n.servers ?? 0) > servers.length ? t('Servers · {shown} of {n} shown', { shown: servers.length, n: n.servers ?? 0 }) : t('Servers · {n}', { n: servers.length })} ids={servers}
        meta={(id) => (owned.includes(id) ? <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">{t('OWNER')}</span> : null)} />
    </>
  }
  const members = nb(n.id, ['member', 'owner'])
  const inside = data.edges.filter((e) => e.t === 'friend' && members.includes(e.a) && members.includes(e.b)).length
  const owner = n.owner_id ? byId.get(n.owner_id) : undefined
  return <>
    <div className="flex items-center gap-2.5"><NetAvatar id={n.id} name={n.name} url={n.icon_url} server size={44} /><div className="min-w-0"><b className="block truncate">{n.name}</b>{owner && <small className="text-text-2">{t('Owned by {name}', { name: label(owner) })}</small>}</div></div>
    {n.state && n.state !== 'active' && <span className="w-fit rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger">{n.state === 'taken_down' ? t('TAKEN DOWN') : t('DELETING')}</span>}
    <div className="grid grid-cols-2 gap-2"><Stat v={n.members ?? members.length} l={t('members')} /><Stat v={inside} l={t('friendships inside')} /></div>
    <div className="flex flex-wrap gap-1.5">
      {focus && focus !== n.id && <button type="button" className={`${btn} bg-accent text-white`} onClick={() => onCenter(n.id)} data-net-center>{t('Center on this server')}</button>}
      {!focus && <NavLink to={networkLink(n.id)} className={`${btn} bg-accent text-white`} data-net-center>{t('Center on this server')}</NavLink>}
      {canServer && <button type="button" className={`${btn} bg-bg-3 font-medium text-text-0`} onClick={() => onOpen(n)} data-net-open>{t('Open server details')}</button>}
    </div>
    {members.length > 0 && <Section title={(n.members ?? 0) > members.length ? t('Members · {shown} of {n} shown', { shown: members.length, n: n.members ?? 0 }) : t('Members · {n}', { n: members.length })} ids={members}
      meta={(id) => (id === n.owner_id ? <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">{t('OWNER')}</span> : null)} />}
  </>
}

