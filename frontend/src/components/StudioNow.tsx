import { AudioLines, Play, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { engine, sharedTransport, useDaw } from '../lib/daw'
import { useT } from '../lib/i18n'
import { projectRights } from '../lib/projects'
import { DEFAULT_STUDIO } from '../lib/studio'
import type { StudioSession } from '../lib/types'
import { useStore } from '../store'

/** 01:02 (or 1:02:03), for the card's clock. */
const clock = (sec: number) => { const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

/** Re-render when the engine starts or stops. */
const usePlaying = () => useSyncExternalStore((f) => engine.subscribe(f), () => engine.playing)

/** The take recording now into the loaded project, if any. */
function useLiveTake(): StudioSession | undefined {
  const project = useDaw((s) => s.project)
  return useStore((s) => (project ? s.studio[project.channel_id]?.find((x) => !x.ended_at && x.project_id === project.id) : undefined))
}

/**
 * The studio project at work while you are somewhere else, above the user panel (as Now Playing is for a song): its
 * name (click to go back to it), whether it plays or records and where, play and stop, and stopping a take. It shows
 * while the project plays or records, while you are in its voice room, and after you stop it from here (✕ hides it).
 */
export default function StudioNow() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const project = useDaw((s) => s.project)
  const follow = useDaw((s) => s.follow)
  const channel = useStore((s) => (project ? s.channels[project.channel_id] : undefined))
  const guild = useStore((s) => (channel?.guild_id ? s.guilds[channel.guild_id] : undefined))
  const inCall = useStore((s) => !!channel && s.myVoiceChannelId === channel.id)
  const me = useStore((s) => s.user?.id)
  const pushToast = useStore((s) => s.pushToast)
  const playing = usePlaying()
  const live = useLiveTake()
  const here = !!channel && pathname.split('/')[3] === channel.id
  // Stopped while away: where, so play goes on from there. Cleared on going back, or with ✕.
  const [parked, setParked] = useState<{ id: string; sec: number } | null>(null)
  const pos = useRef(0)
  const [, tick] = useState(0)
  // The clock, while it shows (on the project's page it re-renders nothing).
  useEffect(() => {
    if ((!playing && !live) || here) return
    const id = setInterval(() => { if (engine.playing) pos.current = engine.position(); tick((n) => n + 1) }, 250)
    return () => clearInterval(id)
  }, [playing, live, here])
  // However it stopped (here, someone else, the take ending), the card stays with play.
  const was = useRef(playing)
  useEffect(() => {
    if (was.current && !playing && project && !here) setParked({ id: project.id, sec: pos.current })
    was.current = playing
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (here) setParked(null) }, [here])
  const park = parked && parked.id === project?.id ? parked : null
  if (!project || !channel || here || !(playing || live || inCall || park)) return null

  const rights = projectRights(channel)
  const canShare = follow && rights.edit
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  const back = () => { navigate(`/channels/${channel.guild_id}/${channel.id}`); useStore.getState().setMobilePane('content') }
  const play = () => {
    engine.unlock()
    const from = park?.sec ?? 0
    if (canShare) void sharedTransport(true, from * 1000).catch(fail)
    else void engine.preload().then(() => engine.play(from, { click: (channel.studio ?? DEFAULT_STUDIO).click }))
  }
  const stop = () => {
    const at = engine.position()
    pos.current = at
    if (playing === 'shared' && canShare) void sharedTransport(false, at * 1000).catch(fail)
    else engine.stop()
  }
  const stopTake = () => { if (live) void api.post(`/channels/${channel.id}/studio/sessions/${live.id}/stop`).catch(fail) }
  const canStopTake = !!live && (live.solo ? live.started_by === me : rights.manage)

  const counting = !!live && Date.now() < Date.parse(live.started_at)
  const state = live ? (counting ? 'count-in' : 'recording') : playing ? 'playing' : 'stopped'
  const label = state === 'recording' ? t('Recording') : state === 'count-in' ? t('Count-in') : state === 'playing' ? t('Playing') : t('Stopped')
  const time = live && !counting ? clock((Date.now() - Date.parse(live.started_at)) / 1000) : playing ? clock(engine.position()) : park ? clock(park.sec) : ''
  const tone = state === 'recording' || state === 'count-in' ? 'text-danger' : state === 'playing' ? 'text-success' : 'text-text-2'
  const btn = 'h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-text-1 hover:bg-white/10 hover:text-text-0'
  return (
    <div className="mb-2 rounded-lg border border-line bg-bg-2 px-2 py-1.5 shadow-lg" data-studio-now={channel.id} data-studio-now-state={state}>
      <div className="flex items-center gap-2">
        <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-3 ${tone}`}>
          <AudioLines size={18} className={state === 'playing' ? 'animate-pulse' : ''} />
          {live && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg-2 animate-pulse" />}
        </span>
        <button type="button" onClick={back} className="min-w-0 flex-1 text-left" title={t('Back to the project')} data-studio-now-back>
          <div className="truncate text-[13px] font-semibold text-text-0" data-studio-now-name>{project.name}</div>
          <div className="truncate text-[11px] text-text-2">
            <span className={`font-semibold ${tone}`} data-studio-now-label>{label}</span>
            {time && <span className="tabular-nums" data-studio-now-time> · {time}</span>}
            {guild && <span> · {guild.name}</span>}
          </div>
        </button>
        {live
          ? canStopTake && <button type="button" onClick={stopTake} className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-danger hover:bg-white/10" title={t('Stop recording')} aria-label={t('Stop recording')} data-studio-now-stop-take><Square size={15} fill="currentColor" /></button>
          : playing
            ? <button type="button" onClick={stop} className={btn} title={t('Stop')} aria-label={t('Stop')} data-studio-now-stop><Square size={15} fill="currentColor" /></button>
            : <button type="button" onClick={play} className={btn} title={t('Play')} aria-label={t('Play')} data-studio-now-play><Play size={17} fill="currentColor" /></button>}
        {park && !playing && !live && !inCall && <button type="button" onClick={() => setParked(null)} className={btn} title={t('Close')} aria-label={t('Close')} data-studio-now-close><X size={17} /></button>}
      </div>
    </div>
  )
}

/** For the sidebar: the project channel that plays or records on this device now, or null. */
export function useStudioActive(): { channelId: string; state: 'playing' | 'recording' } | null {
  const project = useDaw((s) => s.project)
  const playing = usePlaying()
  const live = useLiveTake()
  if (!project || (!playing && !live)) return null
  return { channelId: project.channel_id, state: live ? 'recording' : 'playing' }
}

/** A project row's mark while it plays (moving bars) or records (a red dot) on this device. */
export function StudioActiveMark({ state }: { state: 'playing' | 'recording' }) {
  const t = useT()
  if (state === 'recording') return <span className="h-2 w-2 shrink-0 rounded-full bg-danger animate-pulse" title={t('Recording')} data-studio-active="recording" />
  return (
    <span className="flex h-3 shrink-0 items-end gap-[2px] text-success" title={t('Playing')} data-studio-active="playing">
      {[0, 1, 2].map((i) => <span key={i} className="w-[3px] rounded-sm bg-current studio-eq-bar" style={{ animationDelay: `${i * -0.25}s` }} />)}
    </span>
  )
}
