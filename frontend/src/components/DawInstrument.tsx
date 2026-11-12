import { X } from 'lucide-react'
import { edit, editLive, engine, useDaw } from '../lib/daw'
import { DRUMS, SYNTH_DEFAULT, SYNTH_PARAMS, defaultInstrument, playNote, type Instrument } from '../lib/instruments'
import { useT } from '../lib/i18n'
import type { StudioLane } from '../lib/types'
import Dropdown from './Dropdown'

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`

/** Hear a note on a lane's instrument right now (the keyboard, the piano roll, MIDI input). */
export function audition(lane: StudioLane, p: number, vel = 100, dur: number | null = 0.4) {
  const ctx = engine.audio()
  ctx.resume().catch(() => {})
  const inst = (lane.instrument as Instrument | null) ?? defaultInstrument('synth')
  const sid = inst.type === 'sampler' ? inst.audio_id : null
  const sample = sid ? engine.peek(sid)?.buffer : undefined
  return playNote(ctx, ctx.destination, inst, p, vel, ctx.currentTime + 0.005, dur, [], sample)
}

/** A MIDI track's instrument: synth, drum kit or sampler, its settings, and a keyboard to try it. */
export default function InstrumentPanel({ lane, close }: { lane: StudioLane; close: () => void }) {
  const t = useT()
  const audio = useDaw((s) => s.audio)
  const inst = (lane.instrument as Instrument | null) ?? defaultInstrument('synth')
  const put = (i: Instrument, live?: string) => { const op = { op: 'lane.put' as const, lane: { id: lane.id, instrument: i } }; if (live) editLive(live, [op]); else edit([op]) }
  const samples = Object.values(audio)
  return (
    <div className="absolute right-2 top-2 z-30 w-80 rounded-lg border border-line bg-bg-1 p-3 shadow-2xl" data-daw-instrument={inst.type}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-bold">{t('Instrument')}</span>
        <Dropdown value={inst.type} onChange={(e) => put(defaultInstrument(e.target.value as Instrument['type']))} className="input h-7 w-28 px-1 text-xs" aria-label={t('Instrument')} data-daw-instrument-type>
          <option value="synth">{t('Synth')}</option><option value="drums">{t('Drum kit')}</option><option value="sampler">{t('Sampler')}</option>
        </Dropdown>
        <button type="button" onClick={close} className="ml-auto text-text-2 hover:text-text-0" title={t('Close')}><X size={16} /></button>
      </div>
      {inst.type === 'synth' && SYNTH_PARAMS.map((p) => {
        const v = inst.params[p.key] ?? SYNTH_DEFAULT[p.key]
        return (
          <label key={p.key} className="mb-1 flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-text-2">{p.label}</span>
            <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={v} onChange={(e) => put({ ...inst, params: { ...inst.params, [p.key]: Number(e.target.value) } }, `inst:${lane.id}:${p.key}`)} className="min-w-0 flex-1 accent-accent" data-daw-synth={p.key} />
            <span className="w-14 shrink-0 text-right font-mono tabular-nums">{Number(v.toFixed(2))}{p.unit ? ` ${p.unit}` : ''}</span>
          </label>
        )
      })}
      {inst.type === 'drums' && (
        <>
          <label className="mb-1 flex items-center gap-2 text-xs"><span className="w-24 text-text-2">{t('Tone')}</span><input type="range" min={0} max={1} step={0.01} value={inst.params.tone ?? 0.5} onChange={(e) => put({ ...inst, params: { ...inst.params, tone: Number(e.target.value) } }, `inst:${lane.id}:tone`)} className="flex-1 accent-accent" /></label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {Object.entries(DRUMS).map(([p, name]) => <button key={p} type="button" onPointerDown={() => audition(lane, Number(p))} className="h-10 rounded bg-bg-3 text-[10px] font-semibold hover:bg-bg-4 active:bg-accent" data-daw-pad={p}>{name}</button>)}
          </div>
        </>
      )}
      {inst.type === 'sampler' && (
        <>
          <label className="mb-1 flex items-center gap-2 text-xs"><span className="w-24 text-text-2">{t('Sample')}</span>
            <Dropdown value={inst.audio_id ?? ''} onChange={(e) => { put({ ...inst, audio_id: e.target.value || null }); const tr = audio[e.target.value]; if (tr) void engine.load(tr) }} className="input h-7 min-w-0 flex-1 px-1 text-xs" aria-label={t('Sample')} data-daw-sample>
              <option value="">{samples.length ? t('Pick audio…') : t('Import audio first')}</option>
              {samples.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.display_name}</option>)}
            </Dropdown>
          </label>
          <label className="mb-1 flex items-center gap-2 text-xs"><span className="w-24 text-text-2">{t('Root note')}</span><input type="range" min={24} max={96} value={inst.root} onChange={(e) => put({ ...inst, root: Number(e.target.value) }, `inst:${lane.id}:root`)} className="flex-1 accent-accent" /><span className="w-10 text-right font-mono">{noteName(inst.root)}</span></label>
          <label className="mb-1 flex items-center gap-2 text-xs"><span className="w-24 text-text-2">{t('Release')}</span><input type="range" min={0} max={3000} value={inst.params.r ?? 200} onChange={(e) => put({ ...inst, params: { ...inst.params, r: Number(e.target.value) } }, `inst:${lane.id}:r`)} className="flex-1 accent-accent" /></label>
        </>
      )}
      {inst.type !== 'drums' && (
        <div className="mt-2 flex h-14 select-none" aria-label={t('Keyboard')}>
          {Array.from({ length: 25 }, (_, i) => 48 + i).map((p) => {
            const black = [1, 3, 6, 8, 10].includes(p % 12)
            return <button key={p} type="button" onPointerDown={() => audition(lane, p)} title={noteName(p)} className={`flex-1 border border-black/40 ${black ? 'h-9 bg-black hover:bg-accent' : 'bg-white hover:bg-accent/60'}`} data-daw-key={p} />
          })}
        </div>
      )}
    </div>
  )
}
