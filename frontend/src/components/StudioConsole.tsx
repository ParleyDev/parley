import { Download, MicOff, Play, SkipBack, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useMultitrack, type MixTrack } from '../lib/multitrack'
import { startTake, useStudioArms } from '../lib/studio'
import type { Channel, StudioTrack, User, VoiceState } from '../lib/types'
import { voice } from '../lib/voice'
import { useStore, voiceParticipants } from '../store'
import Avatar from './Avatar'

/** 00:00.0 */
const timecode = (sec: number) => { const s = Math.max(0, sec); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}` }
/** Ruler step that leaves about ten labelled ticks across `span` seconds. */
const rulerStep = (span: number) => [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((x) => span / x <= 12) ?? 3600
const NO_ARMS: string[] = []

type Lane = { userId: string; user: User | undefined; vs: VoiceState | undefined; track: StudioTrack | undefined; mixIndex: number }

/**
 * The engineer's console: a small DAW for the studio. A transport (return to zero, play, record, timecode, take name
 * and take picker), one lane per band member with record-arm and a live input meter, the take drawn on a shared
 * timeline (growing while it records, waveforms once it is in), and per-lane mute / solo / gain for playback with a
 * mixdown export.
 */
export default function StudioConsole({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT()
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const sessions = useStore((s) => s.studio[channel.id])
  const disarmed = useStudioArms((s) => s.disarmed[channel.id] ?? NO_ARMS)
  const toggleArm = useStudioArms((s) => s.toggle)
  const engineers = channel.engineer_ids ?? []
  const live = sessions?.find((x) => !x.ended_at)
  const finished = useMemo(() => (sessions ?? []).filter((x) => x.ended_at), [sessions])
  const [pick, setPick] = useState<string | null>(null)
  // A take that just started stays selected after it stops, so its waveforms come up right away.
  useEffect(() => { if (live) setPick(live.id) }, [live?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const take = live ?? finished.find((x) => x.id === pick) ?? finished[0]
  const mt = useMultitrack(take?.ended_at ? take : undefined)
  const allIn = !!take?.ended_at && take.tracks.length > 0 && take.tracks.every((x) => x.done)
  useEffect(() => { if (allIn && !mt.tracks && !mt.loading && !mt.error) void mt.load() }, [allIn, mt.tracks, mt.loading, mt.error, mt.load])
  useEffect(() => { if (mt.error) pushToast(t('Could not load tracks: {error}', { error: mt.error }), 'error') }, [mt.error])  // eslint-disable-line react-hooks/exhaustive-deps

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!live) return; const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id) }, [live])
  const elapsed = live ? Math.max(0, (now - Date.parse(live.started_at)) / 1000) : 0

  const band = participants.filter((p) => !p.suppress).sort((a, b) => Number(engineers.includes(b.user_id)) - Number(engineers.includes(a.user_id)) || (a.joined_at ?? '').localeCompare(b.joined_at ?? ''))
  // A lane for everyone in the band now, plus anyone who has a track in the take shown.
  const laneIds = [...new Set([...band.map((p) => p.user_id), ...(take?.tracks ?? []).map((x) => x.user_id).filter((x): x is string => !!x)])]
  const lanes: Lane[] = laneIds.map((userId) => {
    const track = take?.tracks.find((x) => x.user_id === userId)
    return { userId, user: users[userId] ?? (me?.id === userId ? me : undefined), vs: participants.find((p) => p.user_id === userId), track, mixIndex: mt.tracks?.findIndex((m) => m.track.id === track?.id) ?? -1 }
  })
  const armedCount = band.filter((p) => !disarmed.includes(p.user_id)).length

  const trackEnd = (x: StudioTrack) => x.offset_ms / 1000 + (x.duration_ms ?? 0) / 1000
  const span = Math.max(live ? 30 : 5, live ? elapsed * 1.25 + 5 : 0, mt.length * 1.05, ...(take?.ended_at ? take.tracks.map(trackEnd) : []))
  const head = live ? elapsed : mt.pos
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / span) * 100))}%`
  const step = rulerStep(span)

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const record = async () => {
    setBusy(true)
    try {
      if (live) await api.post(`/channels/${channel.id}/studio/sessions/${live.id}/stop`)
      else { mt.stop(); await startTake(channel.id, name.trim()); setName('') }
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (live || !mt.tracks) return
    const r = e.currentTarget.getBoundingClientRect()
    mt.seek(((e.clientX - r.left) / r.width) * span)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-line bg-bg-1 overflow-hidden" data-studio-console data-console-state={live ? 'recording' : mt.playing ? 'playing' : 'stopped'}>
      {/* Transport */}
      <div className="shrink-0 flex phone:flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-bg-2">
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => mt.seek(0)} disabled={!!live || !mt.tracks} title={t('Return to zero')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 disabled:opacity-40" data-console-rtz><SkipBack size={18} /></button>
          <button type="button" onClick={() => (mt.playing ? mt.stop() : mt.play(mt.pos))} disabled={!!live || !mt.tracks} title={mt.playing ? t('Stop') : t('Play')} className={`h-9 w-9 rounded-md flex items-center justify-center hover:bg-bg-3 disabled:opacity-40 ${mt.playing ? 'text-success' : 'text-text-1'}`} data-console-play aria-pressed={mt.playing}>{mt.playing ? <Square size={16} /> : <Play size={18} />}</button>
          <button type="button" onClick={record} disabled={busy || (!live && armedCount === 0)} title={live ? t('Stop recording') : t('Record')} className={`h-9 w-9 rounded-md flex items-center justify-center disabled:opacity-40 ${live ? 'bg-danger text-white animate-pulse' : 'text-danger hover:bg-bg-3'}`} data-console-record aria-pressed={!!live}>{live ? <Square size={14} fill="currentColor" /> : <span className="h-4 w-4 rounded-full bg-danger" />}</button>
        </div>
        <span className={`shrink-0 rounded-md bg-bg-0 px-3 py-1 font-mono text-lg tabular-nums ${live ? 'text-danger' : 'text-text-0'}`} data-console-time>{timecode(head)}</span>
        {live ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-danger" data-console-live><span className="h-2 w-2 shrink-0 rounded-full bg-danger animate-pulse" /><span className="truncate">{live.name}</span></span>
        ) : (
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('Next take name')} className="input h-9 min-w-24 flex-1 max-w-56 phone:max-w-none text-sm" data-console-take-name />
        )}
        <span className="text-xs text-text-2 whitespace-nowrap" data-console-armed>{t('{n} of {m} armed', { n: armedCount, m: band.length })}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!live && finished.length > 0 && (
            <select value={take?.id ?? ''} onChange={(e) => setPick(e.target.value)} className="input h-9 w-36 text-sm" title={t('Take')} data-console-take>
              {finished.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          {mt.tracks && <button type="button" onClick={mt.exportWav} className="btn-ghost h-9 py-1 text-xs whitespace-nowrap" title={t('Render all audible tracks to one WAV')} data-console-export><Download size={14} /> {t('Export mix')}</button>}
          <button type="button" onClick={onClose} title={t('Close console')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-console-close><X size={18} /></button>
        </span>
      </div>

      {/* Lanes */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {lanes.length === 0 ? <p className="p-6 text-center text-sm text-text-2">{t('No one is in the band. Make someone an artist to give them a track.')}</p> : (
          <div className="flex min-h-full">
            <div className="w-56 phone:w-36 shrink-0 border-r border-line bg-bg-2/60">
              <div className="h-6 border-b border-line" />
              {lanes.map((l) => <LaneHeader key={l.userId} lane={l} live={!!live} engineer={engineers.includes(l.userId)} armed={!disarmed.includes(l.userId)} inBand={!!l.vs && !l.vs.suppress} mix={l.mixIndex >= 0 ? mt.tracks![l.mixIndex] : undefined} audible={l.mixIndex >= 0 ? mt.audible(mt.tracks![l.mixIndex]) : true} onArm={() => toggleArm(channel.id, l.userId)} onMix={(patch) => mt.update(l.mixIndex, patch)} />)}
            </div>
            <div className={`relative flex-1 min-w-0 ${!live && mt.tracks ? 'cursor-text' : ''}`} onClick={seekAt} data-console-timeline>
              <div className="relative h-6 border-b border-line text-[10px] text-text-2 select-none">
                {Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step).filter((s) => s < span * 0.97).map((s) => <span key={s} className="absolute top-0 h-full border-l border-line pl-1 leading-6" style={{ left: pct(s) }}>{s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`}</span>)}
              </div>
              {lanes.map((l) => (
                <div key={l.userId} className="relative h-16 border-b border-line/60" data-console-lane={l.userId}>
                  {l.track && <Region track={l.track} live={!!live} elapsed={elapsed} mix={l.mixIndex >= 0 ? mt.tracks![l.mixIndex] : undefined} audible={l.mixIndex >= 0 ? mt.audible(mt.tracks![l.mixIndex]) : true} left={pct(l.track.offset_ms / 1000)} width={pct} />}
                </div>
              ))}
              <div className={`pointer-events-none absolute top-0 bottom-0 w-px ${live ? 'bg-danger' : 'bg-text-0'}`} style={{ left: pct(head) }} data-console-playhead />
            </div>
          </div>
        )}
        {take?.ended_at && !allIn && <p className="px-3 py-2 text-xs text-text-2">{t('Waiting for every track to finish uploading…')}</p>}
        {mt.loading && <p className="px-3 py-2 text-xs text-text-2">{t('Decoding…')}</p>}
      </div>
    </div>
  )
}

function LaneHeader({ lane, live, engineer, armed, inBand, mix, audible, onArm, onMix }: { lane: Lane; live: boolean; engineer: boolean; armed: boolean; inBand: boolean; mix: MixTrack | undefined; audible: boolean; onArm: () => void; onMix: (patch: Partial<Pick<MixTrack, 'gain' | 'mute' | 'solo'>>) => void }) {
  const t = useT()
  const name = lane.user?.display_name ?? lane.track?.display_name ?? t('Unknown')
  const status = live
    ? lane.track ? t('Recording · {kb} KB', { kb: Math.round(lane.track.size / 1024) }) : inBand && armed ? t('Starting…') : t('Not recording')
    : !inBand ? t('Left the band') : armed ? t('Armed') : t('Not armed')
  return (
    <div className={`h-16 flex flex-col justify-center gap-1 px-2 border-b border-line/60 ${audible ? '' : 'opacity-60'}`} data-console-lane-head={lane.userId}>
      <div className="flex items-center gap-1.5 min-w-0">
        {lane.user ? <Avatar user={lane.user} size={22} /> : <div className="h-[22px] w-[22px] shrink-0 rounded-full bg-bg-4" />}
        <span className="truncate text-sm font-semibold" title={name}>{name}</span>
        {engineer && <span className="shrink-0 rounded bg-warn px-1 text-[9px] font-bold uppercase text-black">{t('Eng')}</span>}
        {lane.vs?.self_mute && <MicOff size={12} className="shrink-0 text-danger" aria-label={t('Muted')} />}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {inBand && <button type="button" onClick={onArm} disabled={live} title={armed ? t('Disarm track') : t('Arm track for recording')} className={`h-5 w-5 rounded text-[10px] font-bold disabled:cursor-not-allowed ${armed ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={armed} data-console-arm={lane.userId}>R</button>}
          {mix && <button type="button" onClick={() => onMix({ mute: !mix.mute })} title={t('Mute')} className={`h-5 w-5 rounded text-[10px] font-bold ${mix.mute ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={mix.mute} data-console-mute={lane.userId}>M</button>}
          {mix && <button type="button" onClick={() => onMix({ solo: !mix.solo })} title={t('Solo')} className={`h-5 w-5 rounded text-[10px] font-bold ${mix.solo ? 'bg-warn text-black' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} aria-pressed={mix.solo} data-console-solo={lane.userId}>S</button>}
        </span>
      </div>
      {mix ? (
        <input type="range" min={0} max={150} value={Math.round(mix.gain * 100)} onChange={(e) => onMix({ gain: Number(e.target.value) / 100 })} className="h-3 w-full accent-accent" title={t('Volume {n}%', { n: Math.round(mix.gain * 100) })} data-console-gain={lane.userId} />
      ) : inBand ? <Meter userId={lane.userId} /> : null}
      <span className="truncate text-[10px] text-text-2" data-console-status={lane.userId}>{status}</span>
    </div>
  )
}

/** Live input level of a band member, redrawn every frame without re-rendering. */
function Meter({ userId }: { userId: string }) {
  const cover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const l = voice.level(userId)
      if (cover.current) { cover.current.style.width = `${Math.round((1 - l) * 100)}%`; cover.current.parentElement!.dataset.level = l.toFixed(2) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [userId])
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded bg-gradient-to-r from-success via-warn to-danger" data-console-meter={userId}>
      <div ref={cover} className="absolute inset-y-0 right-0 bg-bg-4" style={{ width: '100%' }} />
    </div>
  )
}

/** A lane's take on the timeline: growing while recording, a waveform once decoded, a plain block in between. */
function Region({ track, live, elapsed, mix, audible, left, width }: { track: StudioTrack; live: boolean; elapsed: number; mix: MixTrack | undefined; audible: boolean; left: string; width: (sec: number) => string }) {
  const t = useT()
  const sec = live && !track.done ? Math.max(0, elapsed - track.offset_ms / 1000) : mix ? mix.buffer.duration : (track.duration_ms ?? 0) / 1000
  const tone = live && !track.done ? 'bg-danger/25 border-danger text-danger' : audible ? 'bg-accent/20 border-accent text-accent' : 'bg-bg-3 border-line text-text-2'
  return (
    <div className={`absolute inset-y-1.5 overflow-hidden rounded-md border ${tone}`} style={{ left, width: width(sec) }} data-console-region={track.id} data-region-live={live && !track.done ? '1' : '0'}>
      {mix ? <Wave peaks={mix.peaks} /> : <span className="absolute left-1.5 top-1 text-[10px] font-semibold">{live && !track.done ? t('Recording…') : t('{kb} KB', { kb: Math.round(track.size / 1024) })}</span>}
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
