import { Download, Metronome, MicOff, Play, Rows3, SkipBack, SlidersVertical, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { STORAGE_PREFIX } from '../lib/brand'
import { useT } from '../lib/i18n'
import { laneKey, laneMix, useMultitrack, type LaneMix, type MixTrack } from '../lib/multitrack'
import { DEFAULT_STUDIO, setArm, setStudioConfig, startTake } from '../lib/studio'
import type { Channel, StudioConfig, StudioSession, StudioTrack, User, VoiceState } from '../lib/types'
import { voice } from '../lib/voice'
import { useStore, voiceParticipants } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'

const VIEW_KEY = `${STORAGE_PREFIX}studioConsoleView`
type View = 'arrange' | 'mixer'

/** -00:01.5 / 00:12.3 */
const timecode = (sec: number) => { const s = Math.abs(sec); return `${sec < 0 ? '-' : ''}${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}` }
/** Bar.beat at `sec` from the downbeat (bar 1 starts there; the count-in counts up to it through negative bars). */
const barBeat = (sec: number, bpm: number, beats: number) => { const b = Math.floor((sec * bpm) / 60 + 1e-6); const bar = Math.floor(b / beats); return `${bar >= 0 ? bar + 1 : bar}.${(((b % beats) + beats) % beats) + 1}` }
/** Ruler step (seconds, or whole bars of `bar` seconds) that leaves about ten labelled ticks across `span`. */
const rulerStep = (span: number, bar?: number) => bar ? bar * ([1, 2, 4, 8, 16, 32, 64].find((x) => span / (bar * x) <= 12) ?? 128) : ([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((x) => span / x <= 12) ?? 3600)
const dB = (g: number) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))
const panLabel = (p: number) => (Math.abs(p) < 0.01 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 50)}`)

type Lane = { key: string; user: User | undefined; vs: VoiceState | undefined; clips: StudioTrack[]; name: string }
type Engine = ReturnType<typeof useMultitrack>

/**
 * The engineer's console, a small DAW with two views like Ableton Live (Tab switches when nothing has focus):
 * Arrangement — one lane per band member on a shared timeline (clips growing while they record, waveforms once in) —
 * and Mixer — a channel strip per member (mute, solo, arm, pan, fader, meter) and the master. The control bar holds
 * the studio's tempo, metronome and count-in (shared by its engineers) and the transport.
 */
export default function StudioConsole({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT()
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const sessions = useStore((s) => s.studio[channel.id])
  const cfg = channel.studio ?? DEFAULT_STUDIO
  const engineers = channel.engineer_ids ?? []
  const live = sessions?.find((x) => !x.ended_at)
  const finished = useMemo(() => (sessions ?? []).filter((x) => x.ended_at), [sessions])
  const [pick, setPick] = useState<string | null>(null)
  // A take that just started stays selected after it stops, so its waveforms come up right away.
  useEffect(() => { if (live) setPick(live.id) }, [live?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const take = live ?? finished.find((x) => x.id === pick) ?? finished[0]

  const [view, setView] = useState<View>(() => { try { return localStorage.getItem(VIEW_KEY) === 'mixer' ? 'mixer' : 'arrange' } catch { return 'arrange' } })
  const changeView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || (document.activeElement && document.activeElement !== document.body)) return
      e.preventDefault(); changeView(viewRef.current === 'arrange' ? 'mixer' : 'arrange')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [mix, setMix] = useState<Record<string, LaneMix>>({})
  const [master, setMaster] = useState(1)
  const setLane = (key: string, patch: Partial<LaneMix>) => setMix((m) => ({ ...m, [key]: { ...laneMix(m, key), ...patch } }))
  const mt = useMultitrack(take?.ended_at ? take : undefined, mix, master, cfg.click)
  const allIn = !!take?.ended_at && take.tracks.length > 0 && take.tracks.every((x) => x.done)
  useEffect(() => { if (allIn && !mt.tracks && !mt.loading && !mt.error) void mt.load() }, [allIn, mt.tracks, mt.loading, mt.error, mt.load])
  useEffect(() => { if (mt.error) pushToast(t('Could not load tracks: {error}', { error: mt.error }), 'error') }, [mt.error])  // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render 20 times a second while a take runs; the clock itself is read fresh each render.
  const [, setTick] = useState(0)
  useEffect(() => { if (!live) return; const id = setInterval(() => setTick((n) => n + 1), 50); return () => clearInterval(id) }, [live])
  const elapsed = live ? (Date.now() - Date.parse(live.started_at)) / 1000 : 0
  const counting = !!live && elapsed < 0

  const band = participants.filter((p) => !p.suppress).sort((a, b) => Number(engineers.includes(b.user_id)) - Number(engineers.includes(a.user_id)) || (a.joined_at ?? '').localeCompare(b.joined_at ?? ''))
  // A lane for everyone in the band now, plus anyone with clips in the take shown.
  const lanes: Lane[] = [...new Set([...band.map((p) => p.user_id), ...(take?.tracks ?? []).map(laneKey)])].map((key) => {
    const clips = (take?.tracks ?? []).filter((x) => laneKey(x) === key)
    const user = users[key] ?? (me?.id === key ? me : undefined)
    return { key, user, vs: participants.find((p) => p.user_id === key), clips, name: user?.display_name ?? clips[0]?.display_name ?? t('Unknown') }
  })
  const armed = (key: string) => !cfg.disarmed.includes(key)
  const armedCount = band.filter((p) => armed(p.user_id)).length
  const tempo: { bpm: number; beats: number } = take ?? cfg
  const barSec = cfg.click || take?.click ? (tempo.beats * 60) / tempo.bpm : 0

  const clipEnd = (x: StudioTrack) => x.offset_ms / 1000 + (x.duration_ms ?? 0) / 1000
  const from = Math.min(0, live ? -live.count_in_ms / 1000 : 0, ...(take?.tracks ?? []).map((x) => x.offset_ms / 1000))
  const to = Math.max(from + (live ? 30 : 5), live ? elapsed * 1.25 + 5 : 0, mt.length * 1.05, ...(take?.ended_at ? take.tracks.map(clipEnd) : []))
  const head = live ? elapsed : mt.pos

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const record = async () => {
    setBusy(true)
    try {
      if (live) await api.post(`/channels/${channel.id}/studio/sessions/${live.id}/stop`)
      else { mt.stop(); await startTake(channel.id, name.trim()); setName('') }
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const config = (patch: Partial<Omit<StudioConfig, 'disarmed'>>) => setStudioConfig(channel.id, patch).catch((e) => pushToast((e as Error).message, 'error'))
  const arm = (key: string) => { setArm(channel.id, key, !armed(key)).catch((e) => pushToast((e as Error).message, 'error')) }
  const [bpmDraft, setBpmDraft] = useState<string | null>(null)
  const commitBpm = () => { const v = Math.round(Number(bpmDraft)); setBpmDraft(null); if (bpmDraft !== null && v >= 40 && v <= 300 && v !== cfg.bpm) void config({ bpm: v }) }
  const shared: StripProps = { lanes, engineers, band, mix, setLane, armed, arm, mt, live: !!live }

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-line bg-bg-1 overflow-hidden" data-studio-console data-console-view={view} data-console-state={counting ? 'count-in' : live ? 'recording' : mt.playing ? 'playing' : 'stopped'}>
      {/* Control bar: tempo and metronome, transport, position, view switch */}
      <div className="shrink-0 flex phone:flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-bg-2">
        <div className="flex shrink-0 items-center gap-1">
          <input value={bpmDraft ?? String(cfg.bpm)} onChange={(e) => setBpmDraft(e.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={commitBpm} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} inputMode="numeric" title={t('Tempo (BPM)')} aria-label={t('Tempo (BPM)')} className="input h-8 w-14 px-1 text-center font-mono text-sm tabular-nums" data-console-bpm />
          <Dropdown value={cfg.beats} onChange={(e) => void config({ beats: Number(e.target.value) })} title={t('Time signature')} aria-label={t('Time signature')} className="input h-8 w-[4.5rem] px-2 text-sm" data-console-beats>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
          </Dropdown>
          <button type="button" onClick={() => void config({ click: !cfg.click })} title={cfg.click ? t('Metronome: on') : t('Metronome: off')} aria-pressed={cfg.click} className={`h-8 w-8 rounded-md flex items-center justify-center ${cfg.click ? 'bg-warn text-black' : 'text-text-2 hover:bg-bg-3 hover:text-text-0'}`} data-console-click><Metronome size={16} /></button>
          <Dropdown value={cfg.count_in} onChange={(e) => void config({ count_in: Number(e.target.value) })} title={t('Count-in')} aria-label={t('Count-in')} className="input h-8 w-24 px-1 text-sm" data-console-countin>
            <option value={0}>{t('No count-in')}</option>
            {[1, 2, 4].map((n) => <option key={n} value={n}>{n === 1 ? t('1 bar') : t('{n} bars', { n })}</option>)}
          </Dropdown>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => mt.seek(mt.start)} disabled={!!live || !mt.tracks} title={t('Return to zero')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 disabled:opacity-40" data-console-rtz><SkipBack size={18} /></button>
          <button type="button" onClick={() => (mt.playing ? mt.stop() : mt.play(mt.pos))} disabled={!!live || !mt.tracks} title={mt.playing ? t('Stop') : t('Play')} className={`h-9 w-9 rounded-md flex items-center justify-center hover:bg-bg-3 disabled:opacity-40 ${mt.playing ? 'text-success' : 'text-text-1'}`} data-console-play aria-pressed={mt.playing}>{mt.playing ? <Square size={16} /> : <Play size={18} />}</button>
          <button type="button" onClick={record} disabled={busy || (!live && armedCount === 0)} title={live ? t('Stop recording') : t('Record')} className={`h-9 w-9 rounded-md flex items-center justify-center disabled:opacity-40 ${live ? 'bg-danger text-white animate-pulse' : 'text-danger hover:bg-bg-3'}`} data-console-record aria-pressed={!!live}>{live ? <Square size={14} fill="currentColor" /> : <span className="h-4 w-4 rounded-full bg-danger" />}</button>
        </div>
        <span className={`shrink-0 rounded-md bg-bg-0 px-2.5 py-1 font-mono text-lg tabular-nums ${counting ? 'text-warn' : live ? 'text-danger' : 'text-text-0'}`} data-console-time>{timecode(head)}</span>
        <span className="shrink-0 rounded-md bg-bg-0 px-2 py-1.5 font-mono text-sm tabular-nums text-text-1" title={t('Bar.beat')} data-console-beat>{barBeat(head, tempo.bpm, tempo.beats)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className="flex rounded-md bg-bg-0 p-0.5" role="tablist" aria-label={t('Console view')}>
            <button type="button" role="tab" aria-selected={view === 'arrange'} onClick={() => changeView('arrange')} title={t('Arrangement (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'arrange' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-console-view-arrange><Rows3 size={16} /></button>
            <button type="button" role="tab" aria-selected={view === 'mixer'} onClick={() => changeView('mixer')} title={t('Mixer (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'mixer' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-console-view-mixer><SlidersVertical size={16} /></button>
          </span>
          <button type="button" onClick={onClose} title={t('Close console')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-console-close><X size={18} /></button>
        </span>
      </div>
      {/* Take bar */}
      <div className="shrink-0 flex phone:flex-wrap items-center gap-2 px-3 py-1.5 border-b border-line bg-bg-2/60 text-xs">
        {live ? (
          <span className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold ${counting ? 'text-warn' : 'text-danger'}`} data-console-live><span className="h-2 w-2 shrink-0 rounded-full bg-current animate-pulse" /><span className="truncate">{counting ? t('Count-in · {name}', { name: live.name }) : live.name}</span></span>
        ) : (
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('Next take name')} className="input h-8 min-w-24 flex-1 max-w-64 phone:max-w-none text-sm" data-console-take-name />
        )}
        <span className="whitespace-nowrap text-text-2" data-console-armed>{t('{n} of {m} armed', { n: armedCount, m: band.length })}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!live && finished.length > 0 && (
            <Dropdown value={take?.id ?? ''} onChange={(e) => setPick(e.target.value)} className="input h-8 w-40 text-sm" title={t('Take')} aria-label={t('Take')} data-console-take>
              {finished.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Dropdown>
          )}
          {mt.tracks && <button type="button" onClick={mt.exportWav} className="btn-ghost h-8 py-1 text-xs whitespace-nowrap" title={t('Render all audible tracks to one WAV')} data-console-export><Download size={14} /> {t('Export mix')}</button>}
        </span>
      </div>

      {lanes.length === 0 ? <p className="p-6 text-center text-sm text-text-2">{t('No one is in the band. Make someone an artist to give them a track.')}</p>
        : view === 'arrange' ? <Arrangement {...shared} take={take} from={from} to={to} head={head} elapsed={elapsed} step={rulerStep(to - from, barSec || undefined)} barSec={barSec} />
        : <Mixer {...shared} master={master} setMaster={setMaster} />}
      {take?.ended_at && !allIn && <p className="shrink-0 px-3 py-2 text-xs text-text-2">{t('Waiting for every track to finish uploading…')}</p>}
      {mt.loading && <p className="shrink-0 px-3 py-2 text-xs text-text-2">{t('Decoding…')}</p>}
    </div>
  )
}

type StripProps = {
  lanes: Lane[]; engineers: string[]; band: VoiceState[]
  mix: Record<string, LaneMix>; setLane: (key: string, patch: Partial<LaneMix>) => void
  armed: (key: string) => boolean; arm: (key: string) => void; mt: Engine; live: boolean
}

/** What a lane is doing, in a few words. */
function useLaneStatus() {
  const t = useT()
  return (l: Lane, live: boolean, inBand: boolean, armed: boolean) => {
    const open = l.clips.find((x) => !x.done)
    if (live) return open ? t('Recording · {kb} KB', { kb: Math.round(open.size / 1024) }) : inBand && armed ? t('Starting…') : l.clips.length ? t('Punched out') : t('Not recording')
    if (!inBand) return l.clips.length ? t('Left the band') : ''
    return armed ? t('Armed') : t('Not armed')
  }
}

/** A lane's meter: playback while the take plays, otherwise the member's live input. */
const laneLevel = (mt: Engine, key: string, inBand: boolean) => () => (mt.playing ? mt.level(key) : inBand ? voice.level(key) : 0)

function LaneButtons({ l, inBand, hasClips, big, mix, setLane, armed, arm }: { l: Lane; inBand: boolean; hasClips: boolean; big?: boolean } & Pick<StripProps, 'mix' | 'setLane' | 'armed' | 'arm'>) {
  const t = useT()
  const m = laneMix(mix, l.key), on = armed(l.key)
  const cls = big ? 'h-6 w-full rounded text-[11px] font-bold disabled:opacity-30' : 'h-5 w-5 rounded text-[10px] font-bold'
  return (
    <>
      {(big || hasClips) && <button type="button" onClick={() => setLane(l.key, { mute: !m.mute })} disabled={!hasClips} title={t('Mute')} className={`${cls} ${m.mute ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={m.mute} data-console-mute={l.key}>M</button>}
      {(big || hasClips) && <button type="button" onClick={() => setLane(l.key, { solo: !m.solo })} disabled={!hasClips} title={t('Solo')} className={`${cls} ${m.solo ? 'bg-warn text-black' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={m.solo} data-console-solo={l.key}>S</button>}
      {(big || inBand) && <button type="button" onClick={() => arm(l.key)} disabled={!inBand} title={on ? t('Disarm track') : t('Arm track for recording')} className={`${cls} ${on && inBand ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={on} data-console-arm={l.key}>R</button>}
    </>
  )
}

function Arrangement({ take, from, to, head, elapsed, step, barSec, ...p }: StripProps & { take: StudioSession | undefined; from: number; to: number; head: number; elapsed: number; step: number; barSec: number }) {
  const t = useT()
  const status = useLaneStatus()
  const { lanes, engineers, band, mt, live } = p
  const pct = (sec: number) => `${Math.min(100, Math.max(0, ((sec - from) / (to - from)) * 100))}%`
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (live || !mt.tracks) return
    const r = e.currentTarget.getBoundingClientRect()
    mt.seek(from + ((e.clientX - r.left) / r.width) * (to - from))
  }
  const ticks: number[] = []
  for (let s = Math.ceil(from / step) * step; s < to - (to - from) * 0.03; s += step) ticks.push(s)
  const barLines: number[] = []
  if (barSec > 0 && (to - from) / barSec <= 96) for (let s = Math.ceil(from / barSec) * barSec; s < to; s += barSec) barLines.push(s)
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-console-arrangement>
      <div className="flex min-h-full">
        <div className="w-56 phone:w-36 shrink-0 border-r border-line bg-bg-2/60">
          <div className="h-6 border-b border-line" />
          {lanes.map((l) => {
            const inBand = band.some((x) => x.user_id === l.key)
            return (
              <div key={l.key} className={`h-16 flex flex-col justify-center gap-1 px-2 border-b border-line/60 ${mt.audible(l.key) ? '' : 'opacity-60'}`} data-console-lane-head={l.key}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {l.user ? <Avatar user={l.user} size={22} /> : <div className="h-[22px] w-[22px] shrink-0 rounded-full bg-bg-4" />}
                  <span className="truncate text-sm font-semibold" title={l.name}>{l.name}</span>
                  {engineers.includes(l.key) && <span className="shrink-0 rounded bg-warn px-1 text-[9px] font-bold uppercase text-black">{t('Eng')}</span>}
                  {l.vs?.self_mute && <MicOff size={12} className="shrink-0 text-danger" aria-label={t('Muted')} />}
                  <span className="ml-auto flex shrink-0 items-center gap-0.5"><LaneButtons {...p} l={l} inBand={inBand} hasClips={!!mt.tracks?.some((x) => laneKey(x.track) === l.key)} /></span>
                </div>
                <Meter get={laneLevel(mt, l.key, inBand)} id={l.key} />
                <span className="truncate text-[10px] text-text-2" data-console-status={l.key}>{status(l, live, inBand, p.armed(l.key))}</span>
              </div>
            )
          })}
        </div>
        <div className={`relative flex-1 min-w-0 ${!live && mt.tracks ? 'cursor-text' : ''}`} onClick={seekAt} data-console-timeline>
          {barLines.map((s) => <div key={s} className="pointer-events-none absolute top-6 bottom-0 w-px bg-line/50" style={{ left: pct(s) }} />)}
          {from < 0 && <div className="pointer-events-none absolute top-6 bottom-0 left-0 bg-bg-0/50" style={{ width: pct(0) }} data-console-preroll />}
          <div className="relative h-6 border-b border-line text-[10px] text-text-2 select-none">
            {ticks.map((s) => <span key={s} className="absolute top-0 h-full border-l border-line pl-1 leading-6" style={{ left: pct(s) }}>{barSec > 0 ? String(Math.round(s / barSec) + 1) : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)}s`}</span>)}
          </div>
          {lanes.map((l) => (
            <div key={l.key} className="relative h-16 border-b border-line/60" data-console-lane={l.key}>
              {l.clips.map((c) => <Region key={c.id} clip={c} live={live} elapsed={elapsed} mix={mt.tracks?.find((x) => x.track.id === c.id)} audible={mt.audible(l.key)} left={pct(c.offset_ms / 1000)} width={(sec) => `${Math.max(0, (sec / (to - from)) * 100)}%`} />)}
            </div>
          ))}
          <div className={`pointer-events-none absolute top-0 bottom-0 w-px ${live ? 'bg-danger' : 'bg-text-0'}`} style={{ left: pct(head) }} data-console-playhead />
          {!take && <p className="pointer-events-none absolute inset-x-0 top-10 text-center text-xs text-text-2">{t('Press Record to start the first take.')}</p>}
        </div>
      </div>
    </div>
  )
}

/** Ableton's Mixer: a strip per member (name, status, pan, mute / solo / arm, fader with meter), then the master. */
function Mixer({ master, setMaster, ...p }: StripProps & { master: number; setMaster: (v: number) => void }) {
  const t = useT()
  const status = useLaneStatus()
  const { lanes, engineers, band, mix, setLane, mt, live } = p
  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" data-console-mixer>
      <div className="flex h-full min-h-[18rem] gap-1.5 p-2">
        {lanes.map((l) => {
          const inBand = band.some((x) => x.user_id === l.key)
          const m = laneMix(mix, l.key)
          return (
            <div key={l.key} className={`flex w-24 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-line bg-bg-2 p-1.5 ${mt.audible(l.key) ? '' : 'opacity-60'}`} data-console-strip={l.key}>
              <div className="flex items-center gap-1 min-w-0">
                {l.user ? <Avatar user={l.user} size={18} /> : <div className="h-[18px] w-[18px] shrink-0 rounded-full bg-bg-4" />}
                <span className="truncate text-xs font-semibold" title={l.name}>{l.name}</span>
              </div>
              <div className="flex h-4 items-center gap-1 text-[10px] text-text-2">
                {engineers.includes(l.key) && <span className="shrink-0 rounded bg-warn px-1 text-[9px] font-bold uppercase text-black">{t('Eng')}</span>}
                {l.vs?.self_mute && <MicOff size={11} className="shrink-0 text-danger" aria-label={t('Muted')} />}
                <span className="truncate" data-console-status={l.key}>{status(l, live, inBand, p.armed(l.key))}</span>
              </div>
              <label className="flex flex-col items-center text-[10px] text-text-2" title={t('Pan')}>
                <input type="range" min={-100} max={100} value={Math.round(m.pan * 100)} onChange={(e) => setLane(l.key, { pan: Number(e.target.value) / 100 })} onDoubleClick={() => setLane(l.key, { pan: 0 })} className="h-3 w-full accent-accent" aria-label={t('Pan')} data-console-pan={l.key} />
                <span className="tabular-nums" data-console-pan-label={l.key}>{panLabel(m.pan)}</span>
              </label>
              <div className="grid grid-cols-3 gap-0.5"><LaneButtons {...p} l={l} inBand={inBand} hasClips={!!mt.tracks?.some((x) => laneKey(x.track) === l.key)} big /></div>
              <Fader value={m.gain} onChange={(gain) => setLane(l.key, { gain })} get={laneLevel(mt, l.key, inBand)} id={l.key} label={l.name} />
            </div>
          )
        })}
        <div className="ml-auto flex w-24 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-accent/50 bg-bg-2 p-1.5" data-console-strip="master">
          <span className="text-xs font-bold uppercase tracking-wide text-text-1">{t('Master')}</span>
          <Fader value={master} onChange={setMaster} get={() => mt.level('master')} id="master" label={t('Master')} />
        </div>
      </div>
    </div>
  )
}

/** Vertical fader (silence to +3.5 dB; double-click for 0 dB) beside its meter, with the gain in dB underneath. */
function Fader({ value, onChange, get, id, label }: { value: number; onChange: (v: number) => void; get: () => number; id: string; label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
      <div className="flex min-h-0 flex-1 justify-center gap-1.5">
        <input type="range" min={0} max={150} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} onDoubleClick={() => onChange(1)} className="h-full w-5 accent-accent" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} aria-label={label} data-console-fader={id} />
        <Meter get={get} id={id} vertical />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-text-2" data-console-db={id}>{dB(value)} dB</span>
    </div>
  )
}

/** Meter zones, like a hardware VU: green for most of the travel, amber near the top, red only at the very top. */
const zones = (dir: string) => `linear-gradient(to ${dir}, var(--color-success) 0 72%, var(--color-warn) 72% 90%, var(--color-danger) 90% 100%)`
/** LED segments: thin gaps cut into the lit bar. */
const segments = (dir: string, px: number) => `repeating-linear-gradient(to ${dir}, #000 0 ${px - 1}px, transparent ${px - 1}px ${px}px)`

/**
 * A level meter redrawn every frame without re-rendering: a dark track, the lit part in fixed colour zones (so the
 * colour tells you how hot it is, not the background), and a peak-hold tick that falls back after a moment.
 */
function Meter({ get, id, vertical }: { get: () => number; id: string; vertical?: boolean }) {
  const lit = useRef<HTMLDivElement>(null)
  const peak = useRef<HTMLDivElement>(null)
  const getRef = useRef(get)
  getRef.current = get
  useEffect(() => {
    let raf = 0, hold = 0, holdAt = 0
    const tick = () => {
      const l = getRef.current(), now = performance.now()
      if (l >= hold || now - holdAt > 1200) { hold = Math.max(l, hold - 0.02); if (l >= hold) holdAt = now }
      const off = `${((1 - l) * 100).toFixed(1)}%`
      if (lit.current) { lit.current.style.clipPath = vertical ? `inset(${off} 0 0 0)` : `inset(0 ${off} 0 0)`; lit.current.parentElement!.dataset.level = l.toFixed(2) }
      if (peak.current) { peak.current.style[vertical ? 'bottom' : 'left'] = `calc(${(hold * 100).toFixed(1)}% - 1px)`; peak.current.style.opacity = hold > 0.02 ? '1' : '0' }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [vertical])
  const dir = vertical ? 'top' : 'right'
  return (
    <div className={`relative overflow-hidden rounded-sm bg-black/55 ring-1 ring-inset ring-white/5 ${vertical ? 'h-full w-2.5' : 'h-2 w-full'}`} data-console-meter={id}>
      <div ref={lit} className="absolute inset-0" style={{ background: zones(dir), clipPath: vertical ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)', WebkitMaskImage: vertical ? segments(dir, 4) : undefined, maskImage: vertical ? segments(dir, 4) : undefined }} />
      <div ref={peak} className={`absolute bg-white/80 opacity-0 ${vertical ? 'inset-x-0 h-0.5' : 'inset-y-0 w-0.5'}`} />
    </div>
  )
}

/** A clip on the timeline: growing while it records, a waveform once decoded, a plain block in between. */
function Region({ clip, live, elapsed, mix, audible, left, width }: { clip: StudioTrack; live: boolean; elapsed: number; mix: MixTrack | undefined; audible: boolean; left: string; width: (sec: number) => string }) {
  const t = useT()
  const growing = live && !clip.done
  const sec = growing ? Math.max(0, elapsed - clip.offset_ms / 1000) : mix ? mix.buffer.duration : (clip.duration_ms ?? 0) / 1000
  const tone = growing ? 'bg-danger/25 border-danger text-danger' : audible ? 'bg-accent/20 border-accent text-accent' : 'bg-bg-3 border-line text-text-2'
  return (
    <div className={`absolute inset-y-1.5 overflow-hidden rounded-md border ${tone}`} style={{ left, width: width(sec) }} data-console-region={clip.id} data-region-live={growing ? '1' : '0'}>
      {mix ? <Wave peaks={mix.peaks} /> : <span className="absolute left-1.5 top-1 whitespace-nowrap text-[10px] font-semibold">{growing ? t('Recording…') : t('{kb} KB', { kb: Math.round(clip.size / 1024) })}</span>}
    </div>
  )
}

/** Peaks drawn into a canvas that fills its region (normalised so quiet takes still read). */
function Wave({ peaks }: { peaks: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    let top = 0
    for (const p of peaks) if (p > top) top = p
    const scale = top > 0 ? 0.95 / top : 0
    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1
      if (!w || !h) return
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = getComputedStyle(c).color
      const n = peaks.length
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x / w) * n), b = Math.max(a + 1, Math.floor(((x + 1) / w) * n))
        let m = 0
        for (let i = a; i < b && i < n; i++) if (peaks[i] > m) m = peaks[i]
        const bh = Math.max(1, m * scale * h)
        g.fillRect(x, (h - bh) / 2, 1, bh)
      }
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(c)
    return () => ro.disconnect()
  }, [peaks])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" data-console-wave />
}
