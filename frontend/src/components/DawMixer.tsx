import { ArrowDown, ArrowUp, Power, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { armLane, edit, editLive, engine, audible } from '../lib/daw'
import { FX, newEffect, type Effect, type FxType } from '../lib/fx'
import { useT } from '../lib/i18n'
import type { StudioLane, StudioProject, User } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'
import { Fader } from './StudioConsole'
import InstrumentPanel from './DawInstrument'
import FloatWindow from './FloatWindow'

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
  const e = list.find((x) => x.id === id)
  if (!e) return null
  const def = FX[e.type]
  const set = (key: string, v: number) => setChain(owner, list.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: v } } : x)), `fx:${owner}:${id}:${key}`)
  return (
    <FloatWindow id={`fx-${e.type}`} title={<>{def.name} <span className="font-normal text-text-2">· {title}</span></>} width={288} onClose={close} data-daw-fx-editor={e.type}>
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
    </FloatWindow>
  )
}

/** Momentary loudness of the master while playing. */
function Loudness() {
  const [v, setV] = useState<number | null>(null)
  useEffect(() => { const id = setInterval(() => setV(engine.loudness()), 200); return () => clearInterval(id) }, [])
  return <span className="font-mono text-[10px] tabular-nums text-text-1" title="LUFS (momentary)" data-daw-lufs={v === null ? '' : v.toFixed(1)}>{v === null ? '— LUFS' : `${v.toFixed(1)} LUFS`}</span>
}

/** The input devices on this device, by name (names show once the microphone has been allowed). */
function useInputs() {
  const [list, setList] = useState<string[]>([])
  useEffect(() => {
    const load = () => void navigator.mediaDevices?.enumerateDevices().then((d) => setList([...new Set(d.filter((x) => x.kind === 'audioinput' && x.label && x.deviceId !== 'default').map((x) => x.label))])).catch(() => {})
    load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load)
  }, [])
  return list
}

/** A rotary knob like a hardware console's: drag up / down (Shift for fine), wheel, arrow keys; double-click resets. */
export function Knob({ value, min, max, def, onChange, label, show, size = 30, color = 'var(--color-accent)', bipolar, ...rest }: { value: number; min: number; max: number; def: number; onChange: (v: number) => void; label: string; show?: string; size?: number; color?: string; bipolar?: boolean } & Record<`data-${string}`, string>) {
  const f = (value - min) / (max - min)
  const a0 = -135, a = a0 + f * 270, mid = bipolar ? 0 : a0
  const r = size / 2 - 3, c = size / 2
  const pt = (deg: number) => [c + r * Math.sin((deg * Math.PI) / 180), c - r * Math.cos((deg * Math.PI) / 180)]
  const arc = (from: number, to: number) => { const [x0, y0] = pt(from), [x1, y1] = pt(to); return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1} ${y1}` }
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  const drag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const y0 = e.clientY, v0 = value
    const el = e.currentTarget; el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => set(v0 + ((y0 - ev.clientY) / (ev.shiftKey ? 600 : 150)) * (max - min))
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }
  return (
    <svg width={size} height={size} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number(value.toFixed(3))} aria-valuetext={show} className="shrink-0 cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full" onPointerDown={drag} onDoubleClick={() => set(def)}
      onWheel={(e) => set(value - Math.sign(e.deltaY) * (max - min) / 50)} onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + (max - min) / 50) } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - (max - min) / 50) } }} {...rest}>
      <title>{`${label}${show ? `: ${show}` : ''}`}</title>
      <path d={arc(a0, 135)} fill="none" stroke="currentColor" strokeWidth={3} className="text-bg-4" strokeLinecap="round" />
      {Math.abs(a - mid) > 0.5 && <path d={arc(Math.min(mid, a), Math.max(mid, a))} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />}
      <line x1={c} y1={c} x2={pt(a)[0]} y2={pt(a)[1]} stroke="currentColor" strokeWidth={2} className="text-text-0" strokeLinecap="round" />
    </svg>
  )
}

const dbOf = (g: number) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))
const sec = 'text-[10px] font-bold text-text-1'

/** One track's channel strip, laid out like Ableton Live's mixer. */
function Strip({ l, i, lanes, buses, channelId, users, open, setOpen, instFor, setInstFor }: { l: StudioLane; i: number; lanes: Record<string, StudioLane>; buses: StudioLane[]; channelId: string; users: Record<string, User>; open: { owner: Owner; id: string } | null; setOpen: (o: { owner: Owner; id: string } | null) => void; instFor: string | null; setInstFor: (id: string | null) => void }) {
  const t = useT()
  const me = useStore((s) => s.user)
  const room = useStore((s) => s.channels[channelId])
  const inputs = useInputs()
  const band = [...(room?.engineer_ids ?? []), ...(room?.artist_ids ?? [])]
  const put = (lane: Partial<StudioLane>, live?: string) => { const op = { op: 'lane.put' as const, lane: { id: l.id, ...lane } }; if (live) editLive(live, [op]); else edit([op]) }
  const color = laneColor(l, i)
  const seg = (on: boolean) => `h-5 flex-1 rounded-sm text-[10px] font-bold ${on ? 'bg-warn text-black' : 'bg-bg-3 text-text-2 hover:text-text-0'}`
  const input = l.input ?? { device: '', channel: 'mono' as const }
  const mine = !!me && l.user_id === me.id
  const deviceList = mine ? inputs : input.device ? [input.device] : []
  return (
    <div className={`flex w-36 shrink-0 flex-col gap-1.5 rounded-md border border-line bg-bg-2 text-xs ${audible(lanes, l.id) ? '' : 'opacity-70'}`} data-daw-strip={l.id} data-strip-kind={l.kind}>
      <div className="flex min-w-0 items-center gap-1 rounded-t-md px-1.5 py-1" style={{ background: `color-mix(in srgb, ${color} 35%, transparent)` }}>
        {l.user_id && users[l.user_id] && <Avatar user={users[l.user_id]} size={16} />}
        <span className="truncate font-semibold" title={l.name}>{l.name}</span>
        {l.kind !== 'audio' && <span className="ml-auto shrink-0 rounded bg-bg-4 px-1 text-[9px] font-bold uppercase text-text-1">{l.kind === 'bus' ? t('Bus') : t('MIDI')}</span>}
      </div>
      <div className="flex flex-col gap-1 px-1.5" data-daw-io={l.id}>
        {l.kind === 'audio' && <>
          <span className={sec}>{t('Audio From')}</span>
          <Dropdown value={l.user_id ?? ''} onChange={(e) => put({ user_id: e.target.value || null })} className="input h-6 px-1 text-[10px]" aria-label={t('Audio From')} data-daw-input-user={l.id}>
            <option value="">{t('No input')}</option>
            {[...new Set([...band, ...(l.user_id ? [l.user_id] : [])])].map((uid) => <option key={uid} value={uid}>{users[uid]?.display_name ?? users[uid]?.username ?? uid.slice(0, 6)}</option>)}
          </Dropdown>
          <div className="flex gap-1">
            <Dropdown value={input.device} onChange={(e) => put({ input: { ...input, device: e.target.value } })} disabled={!l.user_id} className="input h-6 min-w-0 flex-1 px-1 text-[10px]" title={mine ? t('Input device') : t('Only {name} can pick their input', { name: l.user_id ? users[l.user_id]?.display_name ?? '' : '' })} aria-label={t('Input device')} data-daw-input-device={l.id}>
              <option value="">{t('Default input')}</option>
              {deviceList.map((d) => <option key={d} value={d}>{d}</option>)}
            </Dropdown>
            <Dropdown value={input.channel} onChange={(e) => put({ input: { ...input, channel: e.target.value as typeof input.channel } })} disabled={!l.user_id} className="input h-6 w-14 px-1 text-[10px]" aria-label={t('Input channel')} data-daw-input-channel={l.id}>
              <option value="mono">{t('Mono')}</option><option value="1">1</option><option value="2">2</option><option value="1/2">1/2</option>
            </Dropdown>
          </div>
          <span className={sec}>{t('Monitor')}</span>
          <div className="flex gap-0.5" role="radiogroup" aria-label={t('Monitor')} data-daw-monitor={l.id}>
            {(['in', 'auto', 'off'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={(l.monitor ?? 'off') === m} onClick={() => put({ monitor: m })} className={seg((l.monitor ?? 'off') === m)} title={m === 'in' ? t('Always hear the input (headphones!)') : m === 'auto' ? t('Hear the input while armed') : t('Never hear the input')} data-daw-monitor-pick={m}>{m === 'in' ? t('In') : m === 'auto' ? t('Auto') : t('Off')}</button>)}
          </div>
        </>}
        {l.kind === 'midi' && <button type="button" onClick={() => setInstFor(instFor === l.id ? null : l.id)} className="h-6 rounded bg-bg-3 text-[10px] font-semibold hover:bg-bg-4" data-daw-instrument-open={l.id}>{t('Instrument: {name}', { name: l.instrument?.type ?? 'synth' })}</button>}
        {l.kind !== 'bus' && <>
          <span className={sec}>{t('Audio To')}</span>
          <Dropdown value={l.sends_only ? 'sends' : l.output_id ?? ''} onChange={(e) => put(e.target.value === 'sends' ? { sends_only: true } : { sends_only: false, output_id: e.target.value || null })} className="input h-6 px-1 text-[10px]" aria-label={t('Audio To')} data-daw-output={l.id}>
            <option value="">{t('Master')}</option>
            {buses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="sends">{t('Sends Only')}</option>
          </Dropdown>
        </>}
      </div>
      <div className="px-1.5"><FxRack owner={l.id} list={l.effects ?? []} picked={open?.owner === l.id ? open.id : null} pick={(id) => setOpen(id ? { owner: l.id, id } : null)} /></div>
      {l.kind !== 'bus' && buses.length > 0 && (
        <div className="border-y border-line/60 px-1.5 py-1" data-daw-sends={l.id}>
          <span className={sec}>{t('Sends')}</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {buses.map((b, bi) => { const v = l.sends?.[b.id] ?? 0; return (
              <span key={b.id} className="flex flex-col items-center" title={t('Send to {name}', { name: b.name })}>
                <Knob value={v} min={0} max={1.5} def={0} onChange={(x) => put({ sends: { ...l.sends, [b.id]: x } }, `send:${l.id}:${b.id}`)} label={t('Send to {name}', { name: b.name })} show={`${dbOf(v)} dB`} size={26} color={laneColor(b, i)} data-daw-send={b.id} />
                <span className="text-[9px] font-bold text-text-2">{String.fromCharCode(65 + bi)}</span>
              </span>
            ) })}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-1.5 px-1.5">
        <div className="flex flex-col items-center gap-1">
          <span className="w-12 rounded bg-bg-0 py-0.5 text-center font-mono text-[10px] tabular-nums" data-console-db={l.id}>{dbOf(l.gain)}</span>
          <Knob value={l.pan} min={-1} max={1} def={0} bipolar onChange={(x) => put({ pan: x }, `pan:${l.id}`)} label={t('Pan')} show={panLabel(l.pan)} data-daw-pan={l.id} />
          <span className="text-[9px] text-text-2 tabular-nums">{panLabel(l.pan)}</span>
          <button type="button" onClick={() => put({ mute: !l.mute })} aria-pressed={!l.mute} title={l.mute ? t('Track off (click to turn on)') : t('Track on (click to mute)')} className="mt-1 h-7 w-7 rounded text-xs font-bold text-black" style={{ background: l.mute ? 'var(--color-bg-4)' : color }} data-daw-activator={l.id}>{i + 1}</button>
          {l.kind !== 'bus' && <button type="button" onClick={() => put({ solo: !l.solo })} aria-pressed={l.solo} title={t('Solo')} className={`h-6 w-7 rounded text-[11px] font-bold ${l.solo ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-daw-strip-solo={l.id}>S</button>}
          {l.kind === 'audio' && <button type="button" onClick={(e) => armLane(l.id, !l.armed, e.ctrlKey || e.metaKey)} aria-pressed={!!l.armed} title={l.armed ? t('Armed: records the next take') : t('Arm for recording')} className={`flex h-6 w-7 items-center justify-center rounded ${l.armed ? 'bg-danger' : 'bg-bg-3'}`} data-daw-strip-arm={l.id}><span className={`h-2.5 w-2.5 rounded-full ${l.armed ? 'bg-black' : 'bg-text-2'}`} /></button>}
        </div>
        <div className="flex min-h-0 flex-1 gap-1">
          <Fader value={l.gain} onChange={(gain) => put({ gain }, `gain:${l.id}`)} get={() => engine.level(l.id)} id={l.id} label={l.name} />
          <div className="flex flex-col justify-between py-0.5 font-mono text-[8px] text-text-2" aria-hidden>{['+3', '0', '-6', '-12', '-24', '-48'].map((d) => <span key={d}>{d}</span>)}</div>
        </div>
      </div>
      {l.kind !== 'bus' && (
        <label className="flex items-center gap-1 px-1.5" title={t('Track delay: moves this track earlier (negative) or later, to fix latency')}>
          <span className={sec}>{t('Delay')}</span>
          <input type="number" min={-1000} max={1000} value={l.nudge_ms ?? 0} onChange={(e) => put({ nudge_ms: Math.max(-1000, Math.min(1000, Math.round(Number(e.target.value) || 0))) }, `nudge:${l.id}`)} className="input h-6 min-w-0 flex-1 px-1 text-right font-mono text-[10px]" aria-label={t('Track delay (ms)')} data-daw-track-delay={l.id} />
          <span className="text-[10px] text-text-2">ms</span>
        </label>
      )}
      <div className="h-1.5 rounded-b-md" style={{ background: color }} />
    </div>
  )
}

/** A strip per track, laid out like Ableton Live's mixer, then the master. */
export default function DawMixer({ ordered, lanes, project, channelId, users }: { ordered: StudioLane[]; lanes: Record<string, StudioLane>; project: StudioProject; channelId: string; users: Record<string, User> }) {
  const t = useT()
  const [open, setOpen] = useState<{ owner: Owner; id: string } | null>(null)
  const [instFor, setInstFor] = useState<string | null>(null)
  const buses = ordered.filter((l) => l.kind === 'bus')
  const chainOf = (o: Owner) => (o === 'master' ? project.master_effects ?? [] : lanes[o]?.effects ?? [])
  return (
    <div className="relative flex-1 min-h-0 overflow-x-auto overflow-y-auto" data-daw-mixer>
      <div className="flex h-full min-h-[34rem] gap-1.5 p-2">
        {ordered.map((l, i) => <Strip key={l.id} {...{ l, i, lanes, buses, channelId, users, open, setOpen, instFor, setInstFor }} />)}
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
