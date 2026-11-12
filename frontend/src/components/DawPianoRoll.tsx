import { Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { editLive } from '../lib/daw'
import { DRUMS, type Instrument, type Note } from '../lib/instruments'
import { useT } from '../lib/i18n'
import { beatsAt, secAtBeat, type Snap } from '../lib/tempo'
import type { StudioClip, StudioLane, StudioProject } from '../lib/types'
import { audition, noteName } from './DawInstrument'
import Dropdown from './Dropdown'

const ROW = 14
const KEYS_W = 64

/**
 * The piano roll for a MIDI clip: notes on a grid of pitches against time (the project's beats). Click to add a
 * note, drag one to move it, drag its right edge to lengthen it, double-click to remove it; Delete removes the
 * selected; Quantize snaps them to the grid; the velocity slider sets how hard they are played. Drum tracks show the
 * kit's sounds by name.
 */
export default function PianoRoll({ clip, lane, project, close }: { clip: StudioClip; lane: StudioLane; project: StudioProject; close: () => void }) {
  const t = useT()
  const drums = (lane.instrument as Instrument | null)?.type === 'drums'
  const pitches = drums ? Object.keys(DRUMS).map(Number).sort((a, b) => b - a) : Array.from({ length: 61 }, (_, i) => 96 - i)
  const notes = (clip.notes ?? []) as Note[]
  const [grid, setGrid] = useState<Snap>('sixteenth')
  const [pps, setPps] = useState(160)
  const [sel, setSel] = useState<number[]>([])
  const [drag, setDrag] = useState<{ i: number; mode: 'move' | 'len'; x0: number; y0: number; orig: Note } | null>(null)
  const lastLen = useRef<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const div = grid === 'bar' ? 1 / project.beats : grid === 'beat' ? 1 : grid === 'half' ? 2 : grid === 'sixteenth' ? 4 : 0
  const clipSec = clip.start_ms / 1000
  /** Snap a time within the clip (ms) to the grid of the song. */
  const snap = (ms: number, free = false) => {
    if (!div || free) return Math.max(0, Math.round(ms))
    const b = Math.round(beatsAt(project, clipSec + ms / 1000) * div) / div
    return Math.max(0, Math.round(secAtBeat(project, b) * 1000 - clip.start_ms))
  }
  const step = () => { const b = beatsAt(project, clipSec); return Math.round((secAtBeat(project, b + (div ? 1 / div : 0.25)) - secAtBeat(project, b)) * 1000) }
  const width = Math.max(400, (clip.length_ms / 1000) * pps)
  const save = (next: Note[]) => editLive(`notes:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, notes: next } }])
  const rowOf = (p: number) => pitches.indexOf(p)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement
      if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); e.stopPropagation(); save(notes.filter((_, i) => !sel.includes(i))); setSel([]) }
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pos = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { ms: ((e.clientX - r.left) / pps) * 1000, row: Math.floor((e.clientY - r.top) / ROW) } }
  const add = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const { ms, row } = pos(e)
    const p = pitches[row]
    if (p === undefined) return
    const n: Note = { p, t: Math.min(clip.length_ms - 10, snap(ms, e.altKey)), d: lastLen.current ?? step(), v: 100 }
    audition(lane, p)
    save([...notes, n]); setSel([notes.length])
  }
  const begin = (e: RPointerEvent<HTMLElement>, i: number, mode: 'move' | 'len') => {
    e.stopPropagation()
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (!sel.includes(i)) setSel(e.shiftKey ? [...sel, i] : [i])
    if (mode === 'move') audition(lane, notes[i].p, notes[i].v)
    setDrag({ i, mode, x0: e.clientX, y0: e.clientY, orig: notes[i] })
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const dms = ((e.clientX - drag.x0) / pps) * 1000
    const o = drag.orig
    let n: Note
    if (drag.mode === 'len') n = { ...o, d: Math.max(10, snap(o.t + o.d + dms, e.altKey) - o.t) }
    else {
      const row = Math.max(0, Math.min(pitches.length - 1, rowOf(o.p) + Math.round((e.clientY - drag.y0) / ROW)))
      n = { ...o, t: Math.max(0, Math.min(clip.length_ms - 10, snap(o.t + dms, e.altKey))), p: pitches[row] }
      if (n.p !== notes[drag.i].p) audition(lane, n.p, n.v, 0.15)
    }
    if (drag.mode === 'len') lastLen.current = n.d
    save(notes.map((x, j) => (j === drag.i ? n : x)))
  }
  const quantize = () => { const which = sel.length ? sel : notes.map((_, i) => i); save(notes.map((n, i) => (which.includes(i) ? { ...n, t: snap(n.t) } : n))) }
  const vel = sel.length ? Math.round(sel.reduce((s, i) => s + (notes[i]?.v ?? 100), 0) / sel.length) : null
  // Beat lines across the clip.
  const lines: { x: number; bar: boolean }[] = []
  for (let b = Math.ceil(beatsAt(project, clipSec)); ; b++) { const ms = secAtBeat(project, b) * 1000 - clip.start_ms; if (ms > clip.length_ms) break; const bar = Math.abs((b - Math.round(beatsAt(project, 0))) % project.beats) === 0; lines.push({ x: (ms / 1000) * pps, bar }) }

  return (
    <div className="shrink-0 flex flex-col border-t border-line bg-bg-1" style={{ height: 300 }} data-daw-piano-roll={clip.id}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bg-2 px-3 py-1 text-xs">
        <span className="font-bold">{t('Piano roll')}</span><span className="truncate text-text-2">{lane.name}</span>
        <Dropdown value={grid} onChange={(e) => setGrid(e.target.value as Snap)} className="input h-7 w-24 px-1 text-xs" aria-label={t('Grid')} data-daw-roll-grid>
          <option value="beat">{t('Beat')}</option><option value="half">{t('½ beat')}</option><option value="sixteenth">{t('1/16')}</option><option value="off">{t('Off')}</option>
        </Dropdown>
        <button type="button" onClick={quantize} className="btn-ghost h-7 py-0 text-xs" title={t('Snap the selected notes (or all) to the grid')} data-daw-quantize><Wand2 size={13} /> {t('Quantize')}</button>
        {vel !== null && <label className="flex items-center gap-1 text-text-2">{t('Velocity')}<input type="range" min={1} max={127} value={vel} onChange={(e) => save(notes.map((n, i) => (sel.includes(i) ? { ...n, v: Number(e.target.value) } : n)))} className="w-24 accent-accent" data-daw-velocity /><span className="w-7 font-mono">{vel}</span></label>}
        <button type="button" onClick={() => setPps((z) => Math.max(40, z / 1.5))} className="ml-auto h-7 w-7 rounded hover:bg-bg-3" title={t('Zoom out')}>−</button>
        <button type="button" onClick={() => setPps((z) => Math.min(1200, z * 1.5))} className="h-7 w-7 rounded hover:bg-bg-3" title={t('Zoom in')}>+</button>
        <button type="button" onClick={close} className="h-7 w-7 rounded text-text-2 hover:bg-bg-3 hover:text-text-0" title={t('Close (Esc)')} data-daw-roll-close><X size={15} className="mx-auto" /></button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky left-0 z-10 shrink-0 bg-bg-2" style={{ width: KEYS_W }}>
          {pitches.map((p) => {
            const black = !drums && [1, 3, 6, 8, 10].includes(p % 12)
            return <button key={p} type="button" onPointerDown={() => audition(lane, p)} className={`block w-full truncate border-b border-black/20 px-1 text-left text-[9px] leading-[13px] ${black ? 'bg-black text-white/70' : 'bg-white text-black/70'}`} style={{ height: ROW }}>{drums ? DRUMS[p] : p % 12 === 0 ? noteName(p) : ''}</button>
          })}
        </div>
        <div ref={box} className="relative shrink-0 cursor-crosshair" style={{ width, height: pitches.length * ROW }} onPointerDown={add} onPointerMove={move} onPointerUp={() => setDrag(null)} data-daw-roll-grid-area>
          {pitches.map((p, r) => <div key={p} className={`pointer-events-none absolute inset-x-0 border-b border-line/30 ${!drums && [1, 3, 6, 8, 10].includes(p % 12) ? 'bg-black/20' : ''}`} style={{ top: r * ROW, height: ROW }} />)}
          {lines.map((l, i) => <div key={i} className={`pointer-events-none absolute top-0 bottom-0 w-px ${l.bar ? 'bg-line' : 'bg-line/30'}`} style={{ left: l.x }} />)}
          {notes.map((n, i) => {
            const r = rowOf(n.p)
            if (r < 0) return null
            return (
              <div key={i} className={`absolute rounded-sm border ${sel.includes(i) ? 'border-white bg-accent' : 'border-black/40 bg-accent/70'} cursor-grab`} style={{ left: (n.t / 1000) * pps, top: r * ROW + 1, width: Math.max(4, (n.d / 1000) * pps), height: ROW - 2, opacity: 0.45 + (n.v / 127) * 0.55 }}
                onPointerDown={(e) => begin(e, i, 'move')} onDoubleClick={(e) => { e.stopPropagation(); save(notes.filter((_, j) => j !== i)); setSel([]) }} data-daw-note={`${n.p}:${n.t}`}>
                <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => begin(e, i, 'len')} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
