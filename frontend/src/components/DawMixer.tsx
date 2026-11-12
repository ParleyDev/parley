import { ArrowDown, ArrowUp, Power, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { edit, editLive, engine, audible } from '../lib/daw'
import { FX, newEffect, type Effect, type FxType } from '../lib/fx'
import { useT } from '../lib/i18n'
import { setArm } from '../lib/studio'
import type { StudioLane, StudioProject, User } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'
import { Fader } from './StudioConsole'
import InstrumentPanel from './DawInstrument'

const COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#00b0f4', '#9b59b6', '#1abc9c']
export const laneColor = (l: StudioLane, i: number) => l.color ?? (l.kind === 'bus' ? '#8e9297' : COLORS[i % COLORS.length])
const panLabel = (p: number) => (Math.abs(p) < 0.01 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 50)}`)
export const fmtParam = (v: number, unit?: string) => `${Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(2))}${unit ? ` ${unit}` : ''}`

type Owner = string | 'master'
/** Change an effect chain: a lane's, or the master's. */
function setChain(owner: Owner, list: Effect[], liveKey?: string) {
  const op = owner === 'master' ? { op: 'project' as const, master_effects: list } : { op: 'lane.put' as const, lane: { id: owner, effects: list } }
  if (liveKey) editLive(liveKey, [op]); else edit([op])
}

/** An insert rack: the effects in order, each with on/off, move, remove, and its editor when picked. */
export function FxRack({ owner, list, picked, pick }: { owner: Owner; list: Effect[]; picked: string | null; pick: (id: string | null) => void }) {
  const t = useT()
  const swap = (i: number, j: number) => { const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; setChain(owner, n) }
  return (
    <div className="flex flex-col gap-0.5" data-daw-fx={owner}>
      {list.map((e, i) => (
        <div key={e.id} className={`group flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] ${picked === e.id ? 'bg-accent/25' : 'bg-bg-3'}`} data-daw-fx-slot={e.type}>
          <button type="button" onClick={() => setChain(owner, list.map((x) => (x.id === e.id ? { ...x, on: !x.on } : x)))} title={e.on ? t('Bypass') : t('Turn on')} aria-pressed={e.on} className={e.on ? 'text-success' : 'text-text-2'} data-daw-fx-power><Power size={10} /></button>
          <button type="button" onClick={() => pick(picked === e.id ? null : e.id)} className={`min-w-0 flex-1 truncate text-left font-semibold ${e.on ? 'text-text-0' : 'text-text-2 line-through'}`} data-daw-fx-open>{FX[e.type]?.name ?? e.type}</button>
          <span className="hidden shrink-0 group-hover:flex">
            {i > 0 && <button type="button" onClick={() => swap(i, i - 1)} title={t('Move up')} className="text-text-2 hover:text-text-0"><ArrowUp size={10} /></button>}
            {i < list.length - 1 && <button type="button" onClick={() => swap(i, i + 1)} title={t('Move down')} className="text-text-2 hover:text-text-0"><ArrowDown size={10} /></button>}
            <button type="button" onClick={() => { setChain(owner, list.filter((x) => x.id !== e.id)); if (picked === e.id) pick(null) }} title={t('Remove')} className="text-text-2 hover:text-danger" data-daw-fx-remove><X size={10} /></button>
          </span>
        </div>
      ))}
      {list.length < 16 && (
        <Dropdown value="" onChange={(e) => { const ty = e.target.value as FxType; if (!ty) return; const n = newEffect(ty); setChain(owner, [...list, n]); pick(n.id) }} className="input h-6 px-1 text-[10px]" aria-label={t('Add effect')} title={t('Add effect')} data-daw-fx-add>
          <option value="">{t('+ Effect')}</option>
          {Object.values(FX).map((f) => <option key={f.type} value={f.type}>{f.name}</option>)}
        </Dropdown>
      )}
    </div>
  )
}

/** The picked effect's controls. */
export function FxEditor({ owner, list, id, close, title }: { owner: Owner; list: Effect[]; id: string; close: () => void; title: string }) {
  const t = useT()
  const e = list.find((x) => x.id === id)
  if (!e) return null
  const def = FX[e.type]
  const set = (key: string, v: number) => setChain(owner, list.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: v } } : x)), `fx:${owner}:${id}:${key}`)
  return (
    <div className="absolute right-2 top-2 z-30 w-72 rounded-lg border border-line bg-bg-1 p-3 shadow-2xl" data-daw-fx-editor={e.type}>
      <div className="mb-2 flex items-center gap-2"><span className="font-bold">{def.name}</span><span className="truncate text-xs text-text-2">{title}</span><button type="button" onClick={close} className="ml-auto text-text-2 hover:text-text-0" title={t('Close')}><X size={16} /></button></div>
      {def.params.map((p) => {
        const v = e.params[p.key] ?? p.def
        // Frequencies move on a log scale, like real knobs.
        const toPos = (x: number) => (p.log ? Math.log(x / p.min) / Math.log(p.max / p.min) : (x - p.min) / (p.max - p.min)) * 1000
        const fromPos = (pos: number) => { const f = pos / 1000; const x = p.log ? p.min * Math.pow(p.max / p.min, f) : p.min + f * (p.max - p.min); return p.step ? Math.round(x / p.step) * p.step : Math.round(x) }
        return (
          <label key={p.key} className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-text-2">{p.label}</span>
            <input type="range" min={0} max={1000} value={Math.round(toPos(v))} onChange={(ev) => set(p.key, fromPos(Number(ev.target.value)))} onDoubleClick={() => set(p.key, p.def)} className="min-w-0 flex-1 accent-accent" data-daw-fx-param={p.key} />
            <span className="w-16 shrink-0 text-right font-mono tabular-nums">{fmtParam(v, p.unit)}</span>
          </label>
        )
      })}
    </div>
  )
}

/** Momentary loudness of the master while playing. */
function Loudness() {
  const [v, setV] = useState<number | null>(null)
  useEffect(() => { const id = setInterval(() => setV(engine.loudness()), 200); return () => clearInterval(id) }, [])
  return <span className="font-mono text-[10px] tabular-nums text-text-1" title="LUFS (momentary)" data-daw-lufs={v === null ? '' : v.toFixed(1)}>{v === null ? '— LUFS' : `${v.toFixed(1)} LUFS`}</span>
}

/** A strip per lane (inserts, sends, output, pan, mute / solo / arm, fader with meter), then the master. */
export default function DawMixer({ ordered, lanes, project, band, disarmed, crew, channelId, users }: { ordered: StudioLane[]; lanes: Record<string, StudioLane>; project: StudioProject; band: string[]; disarmed: string[]; crew: boolean; channelId: string; users: Record<string, User> }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState<{ owner: Owner; id: string } | null>(null)
  const [instFor, setInstFor] = useState<string | null>(null)
  const buses = ordered.filter((l) => l.kind === 'bus')
  const chainOf = (o: Owner) => (o === 'master' ? project.master_effects ?? [] : lanes[o]?.effects ?? [])
  return (
    <div className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden" data-daw-mixer>
      <div className="flex h-full min-h-[24rem] gap-1.5 p-2">
        {ordered.map((l, i) => {
          const inBand = !!l.user_id && band.includes(l.user_id)
          const armed = inBand && !disarmed.includes(l.user_id!)
          const btn = (on: boolean, cls: string) => `h-6 w-full rounded text-[11px] font-bold disabled:opacity-30 ${on ? cls : 'bg-bg-3 text-text-2 hover:text-text-0'}`
          return (
            <div key={l.id} className={`flex w-28 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-line bg-bg-2 p-1.5 ${audible(lanes, l.id) ? '' : 'opacity-60'}`} style={{ borderTopColor: laneColor(l, i), borderTopWidth: 3 }} data-daw-strip={l.id} data-strip-kind={l.kind}>
              <div className="flex min-w-0 items-center gap-1">
                {l.user_id && users[l.user_id] && <Avatar user={users[l.user_id]} size={16} />}
                <span className="truncate text-xs font-semibold" title={l.name}>{l.name}</span>
                {l.kind !== 'audio' && <span className="ml-auto shrink-0 rounded bg-bg-4 px-1 text-[9px] font-bold uppercase text-text-1">{l.kind === 'bus' ? t('Bus') : t('MIDI')}</span>}
              </div>
              {l.kind === 'midi' && <button type="button" onClick={() => setInstFor(instFor === l.id ? null : l.id)} className="h-6 rounded bg-bg-3 text-[10px] font-semibold hover:bg-bg-4" data-daw-instrument-open={l.id}>{t('Instrument: {name}', { name: l.instrument?.type ?? 'synth' })}</button>}
              <FxRack owner={l.id} list={l.effects ?? []} picked={open?.owner === l.id ? open.id : null} pick={(id) => setOpen(id ? { owner: l.id, id } : null)} />
              {l.kind !== 'bus' && buses.length > 0 && (
                <div className="flex flex-col gap-0.5" data-daw-sends={l.id}>
                  {buses.map((b) => (
                    <label key={b.id} className="flex items-center gap-1 text-[9px] text-text-2" title={t('Send to {name}', { name: b.name })}>
                      <span className="w-8 truncate">{b.name}</span>
                      <input type="range" min={0} max={150} value={Math.round((l.sends?.[b.id] ?? 0) * 100)} onChange={(e) => editLive(`send:${l.id}:${b.id}`, [{ op: 'lane.put', lane: { id: l.id, sends: { ...l.sends, [b.id]: Number(e.target.value) / 100 } } }])} className="h-2.5 min-w-0 flex-1 accent-accent" data-daw-send={b.id} />
                    </label>
                  ))}
                </div>
              )}
              {l.kind !== 'bus' && buses.length > 0 && (
                <Dropdown value={l.output_id ?? ''} onChange={(e) => edit([{ op: 'lane.put', lane: { id: l.id, output_id: e.target.value || null } }])} className="input h-6 px-1 text-[10px]" title={t('Output')} aria-label={t('Output')} data-daw-output={l.id}>
                  <option value="">{t('→ Master')}</option>
                  {buses.map((b) => <option key={b.id} value={b.id}>→ {b.name}</option>)}
                </Dropdown>
              )}
              <label className="flex flex-col items-center text-[10px] text-text-2" title={t('Pan')}>
                <input type="range" min={-100} max={100} value={Math.round(l.pan * 100)} onChange={(e) => editLive(`pan:${l.id}`, [{ op: 'lane.put', lane: { id: l.id, pan: Number(e.target.value) / 100 } }])} onDoubleClick={() => edit([{ op: 'lane.put', lane: { id: l.id, pan: 0 } }])} className="h-3 w-full accent-accent" aria-label={t('Pan')} data-daw-pan={l.id} />
                <span className="tabular-nums">{panLabel(l.pan)}</span>
              </label>
              <div className="grid grid-cols-3 gap-0.5">
                <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, mute: !l.mute } }])} aria-pressed={l.mute} title={t('Mute')} className={btn(l.mute, 'bg-danger text-white')}>M</button>
                <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, solo: !l.solo } }])} aria-pressed={l.solo} title={t('Solo')} className={btn(l.solo, 'bg-warn text-black')}>S</button>
                <button type="button" disabled={!inBand || !crew} onClick={() => setArm(channelId, l.user_id!, !armed).catch((e) => pushToast((e as Error).message, 'error'))} aria-pressed={armed} title={t('Arm')} className={btn(armed, 'bg-danger text-white')}>R</button>
              </div>
              <Fader value={l.gain} onChange={(gain) => editLive(`gain:${l.id}`, [{ op: 'lane.put', lane: { id: l.id, gain } }])} get={() => engine.level(l.id)} id={l.id} label={l.name} />
            </div>
          )
        })}
        <div className="ml-auto flex w-28 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-accent/50 bg-bg-2 p-1.5" data-daw-strip="master">
          <span className="text-xs font-bold uppercase tracking-wide text-text-1">{t('Master')}</span>
          <FxRack owner="master" list={project.master_effects ?? []} picked={open?.owner === 'master' ? open.id : null} pick={(id) => setOpen(id ? { owner: 'master', id } : null)} />
          <Loudness />
          <Fader value={project.master_gain} onChange={(v) => editLive('master', [{ op: 'project', master_gain: v }])} get={() => engine.level('master')} id="master" label={t('Master')} />
        </div>
      </div>
      {open && <FxEditor owner={open.owner} list={chainOf(open.owner)} id={open.id} close={() => setOpen(null)} title={open.owner === 'master' ? t('Master') : lanes[open.owner]?.name ?? ''} />}
      {instFor && lanes[instFor] && <InstrumentPanel lane={lanes[instFor]} close={() => setInstFor(null)} />}
    </div>
  )
}
