import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { editLive, sortedLanes, valueAt } from '../lib/daw'
import { FX, fxParam } from '../lib/fx'
import { useT } from '../lib/i18n'
import type { StudioLane } from '../lib/types'
import { fmtParam } from './DawMixer'

type Pt = [number, number]
export type AutoParam = { key: string; label: string; min: number; max: number; def: number; log?: boolean; unit?: string }

/** What a lane can automate: volume, pan, its sends and its effects' automatable parameters. */
export function autoParams(l: StudioLane, lanes: Record<string, StudioLane>): AutoParam[] {
  const out: AutoParam[] = [{ key: 'gain', label: 'Volume', min: 0, max: 1.5, def: l.gain }, { key: 'pan', label: 'Pan', min: -1, max: 1, def: l.pan }]
  for (const b of sortedLanes(lanes).filter((x) => x.kind === 'bus' && x.id !== l.id && l.sends?.[x.id] !== undefined)) out.push({ key: `send:${b.id}`, label: `Send → ${b.name}`, min: 0, max: 1.5, def: l.sends[b.id] })
  for (const e of l.effects ?? []) for (const p of FX[e.type]?.params ?? []) if (p.auto) out.push({ key: `fx:${e.id}:${p.key}`, label: `${FX[e.type].name} · ${p.label}`, min: p.min, max: p.max, def: e.params[p.key] ?? p.def, log: p.log, unit: p.unit })
  return out
}
export const paramOf = (l: StudioLane, lanes: Record<string, StudioLane>, key: string) => autoParams(l, lanes).find((p) => p.key === key) ?? (key.startsWith('fx:') ? (() => { const [, id, k] = key.split(':'); const e = l.effects?.find((x) => x.id === id); const d = e && fxParam(e.type, k); return d ? { key, label: k, min: d.min, max: d.max, def: d.def, log: d.log } : null })() : null)

/**
 * An automation lane: the parameter's breakpoints as a line over the timeline. Click to add a point, drag one to
 * move it, double-click one to remove it. Shared like every other edit.
 */
export function AutoRow({ lane, param, pps, width, height, snapMs }: { lane: StudioLane; param: AutoParam; pps: number; width: number; height: number; snapMs: (ms: number, free?: boolean) => number }) {
  const t = useT()
  const pts = (lane.automation?.[param.key] ?? []) as Pt[]
  const [drag, setDrag] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const pad = 6, h = height - pad * 2
  const norm = (v: number) => (param.log ? Math.log(Math.max(param.min, v) / param.min) / Math.log(param.max / param.min) : (v - param.min) / (param.max - param.min))
  const denorm = (f: number) => { const x = Math.max(0, Math.min(1, f)); return param.log ? param.min * Math.pow(param.max / param.min, x) : param.min + x * (param.max - param.min) }
  const y = (v: number) => pad + (1 - norm(v)) * h
  const at = (e: { clientX: number; clientY: number }, free: boolean) => { const r = svg.current!.getBoundingClientRect(); return [Math.max(0, Math.round(snapMs(((e.clientX - r.left) / pps) * 1000, free))), denorm(1 - (e.clientY - r.top - pad) / h)] as Pt }
  const save = (next: Pt[]) => {
    const sorted = [...next].sort((a, b) => a[0] - b[0])
    const automation = { ...lane.automation }
    if (sorted.length) automation[param.key] = sorted.map(([ms, v]) => [ms, Number(v.toFixed(4))] as Pt); else delete automation[param.key]
    editLive(`auto:${lane.id}:${param.key}`, [{ op: 'lane.put', lane: { id: lane.id, automation } }])
  }
  const down = (e: RPointerEvent<SVGElement>, i: number | null) => {
    e.stopPropagation()
    if (e.button !== 0) return
    svg.current!.setPointerCapture(e.pointerId)
    if (i === null) { const p = at(e, e.altKey); const next = [...pts, p]; save(next); setDrag(next.length - 1) } else setDrag(i)
  }
  const move = (e: RPointerEvent<SVGElement>) => {
    if (drag === null) return
    const next = pts.map((p, i) => (i === drag ? at(e, e.altKey) : p))
    save(next)
  }
  const line = pts.length ? [[0, valueAt(pts, 0)] as Pt, ...pts, [width / pps * 1000, pts[pts.length - 1][1]] as Pt].map(([ms, v]) => `${(ms / 1000) * pps},${y(v)}`).join(' ') : ''
  return (
    <svg ref={svg} width={width} height={height} className="block cursor-crosshair bg-bg-0/40" onPointerDown={(e) => down(e, null)} onPointerMove={move} onPointerUp={() => setDrag(null)} data-daw-auto-row={`${lane.id}:${param.key}`}>
      {pts.length === 0 && <>
        <line x1={0} x2={width} y1={y(param.def)} y2={y(param.def)} stroke="currentColor" strokeDasharray="4 4" className="text-text-2/60" />
        <text x={8} y={14} className="fill-text-2 text-[10px]">{t('Click to add a point · {name} {value}', { name: param.label, value: fmtParam(param.def, param.unit) })}</text>
      </>}
      {pts.length > 0 && <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-warn" />}
      {pts.map(([ms, v], i) => (
        <circle key={i} cx={(ms / 1000) * pps} cy={y(v)} r={drag === i ? 6 : 4.5} className="fill-warn stroke-black/60 cursor-grab" onPointerDown={(e) => down(e, i)} onDoubleClick={(e) => { e.stopPropagation(); save(pts.filter((_, j) => j !== i)) }} data-daw-auto-point={i}>
          <title>{`${fmtParam(v, param.unit)} @ ${(ms / 1000).toFixed(2)} s`}</title>
        </circle>
      ))}
    </svg>
  )
}
