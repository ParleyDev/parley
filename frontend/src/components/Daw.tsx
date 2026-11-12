import { Activity, Archive, Link2, CalendarClock, Mic, Disc3, Users, ArrowLeft, ChevronDown, Pencil, Copy, Download, Flag, FolderOpen, History, Keyboard, Layers, Magnet, MessageSquare, Metronome, Music, Piano, Plus, Redo2, Repeat, Rows3, Scissors, SkipBack, SlidersVertical, Square, Play, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut, Gauge, Cable } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { STORAGE_PREFIX } from '../lib/brand'
import '../lib/monitor'
import { deleteProject, projectRights, TAGS, tagOf, updateProject } from '../lib/projects'
import { useNavigate } from 'react-router-dom'
import { audible, armLane, takeLane, setFollow, sharedTransport, clipEnd, edit, editLive, engine, importFiles, loadProject, newId, projectEnd, redo, sharePresence, sortedLanes, undo, useDaw, type Op } from '../lib/daw'
import { defaultInstrument, type Note } from '../lib/instruments'
import { armMidi, connectMidi, useMidi } from '../lib/midi'
import { useT } from '../lib/i18n'
import { setStudioConfig, startTake, DEFAULT_STUDIO } from '../lib/studio'
import { usePhone } from '../lib/swipe'
import { barBeat, bars as barList, secAtBar, snapTo, type Snap, type TempoChange } from '../lib/tempo'
import type { Channel, StudioClip, StudioLane, StudioProject, StudioTrack, User } from '../lib/types'
import { voice } from '../lib/voice'
import { useStore, voiceParticipants } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'
import { Meter } from './StudioConsole'
import DawMixer, { laneColor } from './DawMixer'
import { AutoRow, autoParams, paramOf } from './DawAutomation'
import PianoRoll from './DawPianoRoll'
import { BandPanel, CommentsPanel, ExportPanel, SessionsPanel, TakesPanel, VersionsPanel } from './DawPanels'
import FloatWindow from './FloatWindow'

const VIEW_KEY = `${STORAGE_PREFIX}dawView`
const ZOOM_KEY = `${STORAGE_PREFIX}dawZoom`
const SNAP_KEY = `${STORAGE_PREFIX}dawSnap`
const LANE_H = 76
const AUTO_H = 56
const PEER_COLORS = ['#f47fff', '#00d1b2', '#ffb02e', '#4fc3f7', '#ff6b6b', '#a3e635']

/** 01:02.3 */
const timecode = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(1).padStart(4, '0')}`
const dB = (g: number) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1))

/** Re-render when the engine starts or stops; read its position each frame while playing. */
function useEngine() {
  return useSyncExternalStore((f) => engine.subscribe(f), () => engine.playing)
}
function usePlayhead(playing: boolean, stopped: number) {
  const [pos, setPos] = useState(stopped)
  useEffect(() => {
    if (!playing) { setPos(stopped); return }
    let raf = 0
    const tick = () => { setPos(engine.position()); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, stopped])
  return pos
}

type Drag = { ids: string[]; mode: 'move' | 'trimL' | 'trimR' | 'fadeIn' | 'fadeOut'; x0: number; lane0: string; dms: number; lane: string | null; copy: boolean }
type Panel = 'comments' | 'versions' | 'export' | 'tempo' | 'takes' | 'band' | 'sessions' | null

/**
 * The studio's DAW, shared live by everyone in the band: an Arrangement of audio, MIDI and bus tracks on a timeline
 * with the song's tempo map (move, trim, split, duplicate, fades, clip gain, takes, snapping, zoom, a loop range,
 * markers, comments, automation lanes, a piano roll for MIDI clips, and where the others are), a Mixer (inserts,
 * sends, routing, faders, the master with its loudness), the transport and recording (a take for the band or alone,
 * over the project from the playhead or the loop, punched into the range), imports, undo and redo, versions, and
 * exports. Phones get the lite version: play, record, levels, comments and the timeline to look at.
 */
export default function Daw({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT()
  const phone = usePhone()
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const sessions = useStore((s) => s.studio[channel.id])
  const live = sessions?.find((x) => !x.ended_at)
  const cfg = channel.studio ?? DEFAULT_STUDIO
  const engineers = channel.engineer_ids ?? []
  const crew = (!!me && engineers.includes(me.id)) || projectRights(channel).manage
  const { project, lanes, clips, audio, loading, error, canUndo, canRedo, comments, peers } = useDaw(useShallow((s) => ({ project: s.project, lanes: s.lanes, clips: s.clips, audio: s.audio, loading: s.loading, error: s.error, canUndo: s.undo.length > 0, canRedo: s.redo.length > 0, comments: s.comments, peers: s.peers })))
  const midi = useMidi()
  const playing = useEngine()
  const [stopped, setStopped] = useState(0)
  const head = usePlayhead(!!playing, stopped)
  const ordered = useMemo(() => sortedLanes(lanes), [lanes])
  const band = participants.filter((p) => !p.suppress)
  const inBand = !!me && band.some((p) => p.user_id === me.id)

  const [view, setView] = useState<'arrange' | 'mixer'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'mixer' || (phone && localStorage.getItem(VIEW_KEY) !== 'arrange') ? 'mixer' : 'arrange' } catch { return 'arrange' } })
  const changeView = (v: 'arrange' | 'mixer') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }
  const [pps, setPps] = useState(() => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 40 } catch { return 40 } })
  const zoom = (f: number) => setPps((z) => { const n = Math.min(400, Math.max(4, z * f)); try { localStorage.setItem(ZOOM_KEY, String(n)) } catch { /* ignore */ } return n })
  const [snap, setSnapState] = useState<Snap>(() => { try { return (localStorage.getItem(SNAP_KEY) as Snap) || 'beat' } catch { return 'beat' } })
  const setSnap = (s: Snap) => { setSnapState(s); try { localStorage.setItem(SNAP_KEY, s) } catch { /* ignore */ } }
  const [sel, setSel] = useState<string[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [roll, setRoll] = useState<string | null>(null)
  const [autoOpen, setAutoOpen] = useState<Record<string, string>>({})
  useEffect(() => { setSel((s) => s.filter((id) => clips[id])); if (roll && !clips[roll]) setRoll(null) }, [clips]) // eslint-disable-line react-hooks/exhaustive-deps

  const bpm = project?.bpm ?? cfg.bpm, beats = project?.beats ?? cfg.beats
  const snapMs = (ms: number, free = false) => (free || !project ? ms : snapTo(project, ms, snap))

  // Keep the open project loaded (lib/daw also does while we are in the studio's voice).
  useEffect(() => { if (cfg.project_id && project?.id !== cfg.project_id) void loadProject(cfg.project_id) }, [cfg.project_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Others see where we are.
  useEffect(() => { if (project && !phone) sharePresence(head * 1000, !!playing, sel) }, [Math.round(head * 4), !!playing, sel.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // Peers that went quiet fade out.
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 3000); return () => clearInterval(id) }, [])

  // Play and stop are everyone's in the project (shared playback) for its band, unless following is off here.
  const follow = useDaw((s) => s.follow)
  const canShare = follow && projectRights(channel).edit
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  const play = () => {
    if (playing) { const pos = engine.position(); setStopped(pos); if (playing === 'shared' && canShare) void sharedTransport(false, pos * 1000).catch(fail); else engine.stop(); return }
    if (canShare) void sharedTransport(true, stopped * 1000).catch(fail)
    else void engine.preload().then(() => engine.play(stopped, { click: cfg.click }))
  }
  const seek = (sec: number) => { const s = Math.max(0, sec); setStopped(s); if (playing === 'local') engine.play(s, { click: cfg.click }); else if (playing === 'shared' && canShare) void sharedTransport(true, s * 1000).catch(fail) }
  // Someone else stopped the shared playback: the playhead stays where it stopped.
  const sharedStop = project?.play_at ? null : project?.play_from_ms
  useEffect(() => { if (sharedStop != null && follow) setStopped(sharedStop / 1000) }, [sharedStop]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const record = async (solo: boolean) => {
    setBusy(true)
    try {
      if (live) await api.post(`/channels/${channel.id}/studio/sessions/${live.id}/stop`)
      else { engine.stop(); await startTake(channel.id, '', stopped * 1000, solo) }
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  // When a take ends the playhead stays where recording stopped.
  const wasLive = useRef<string | null>(null)
  useEffect(() => { if (live) wasLive.current = live.id; else if (wasLive.current) { wasLive.current = null; setStopped(engine.position() || stopped) } }, [live?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = sel.map((id) => clips[id]).filter(Boolean)
  const del = () => { if (selected.length) edit(selected.map((c): Op => ({ op: 'clip.del', id: c.id }))); setSel([]) }
  const duplicate = () => {
    if (!selected.length) return
    const span = Math.max(...selected.map(clipEnd)) - Math.min(...selected.map((c) => c.start_ms))
    const copies = selected.map((c) => ({ ...c, id: newId(), start_ms: c.start_ms + span, group_id: null }))
    edit(copies.map((c): Op => ({ op: 'clip.put', clip: { ...c, group_id: '' as unknown as null } })))
    setSel(copies.map((c) => c.id))
  }
  const split = () => {
    const at = head * 1000
    const ops: Op[] = []
    const made: string[] = []
    // Takes split together, so each part keeps its alternatives.
    const targets = selected.length ? selected : Object.values(clips)
    const all = targets.flatMap((c) => (c.group_id ? Object.values(clips).filter((x) => x.group_id === c.group_id) : [c])).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i)
    const groups = new Map<string, string>()
    for (const c of all) {
      if (at <= c.start_ms + 5 || at >= clipEnd(c) - 5) continue
      const left = Math.round(at - c.start_ms)
      const id = newId(); made.push(id)
      const g = c.group_id ? (groups.get(c.group_id) ?? (groups.set(c.group_id, newId()), groups.get(c.group_id)!)) : ''
      ops.push({ op: 'clip.put', clip: { id: c.id, length_ms: left, fade_out_ms: 0 } })
      const notes = c.notes ? { notes: (c.notes as Note[]).filter((n) => n.t >= left).map((n) => ({ ...n, t: n.t - left })) } : {}
      if (c.notes) ops.push({ op: 'clip.put', clip: { id: c.id, notes: (c.notes as Note[]).filter((n) => n.t < left) } })
      ops.push({ op: 'clip.put', clip: { ...c, id, start_ms: c.start_ms + left, in_ms: c.notes ? 0 : c.in_ms + left, length_ms: c.length_ms - left, fade_in_ms: 0, group_id: g as unknown as null, ...notes } })
    }
    if (ops.length) { edit(ops); setSel(made) }
  }
  const lastPos = () => (ordered[ordered.length - 1]?.position ?? -1) + 1
  const addLane = (kind: 'audio' | 'midi' | 'bus') => {
    const id = newId()
    const n = ordered.filter((l) => l.kind === kind).length + 1
    edit([{ op: 'lane.put', lane: { id, kind, name: kind === 'bus' ? t('Bus {n}', { n }) : kind === 'midi' ? t('MIDI {n}', { n }) : t('Track {n}', { n: ordered.length + 1 }), position: lastPos(), ...(kind === 'midi' ? { instrument: defaultInstrument('synth') } : {}) } }])
    if (kind === 'midi') armMidi(id)
  }
  const newMidiClip = (laneId: string, atMs: number) => {
    if (!project) return
    const { bar } = barBeat(project, atMs / 1000)
    const start = Math.round(secAtBar(project, bar - 1) * 1000), end = Math.round(secAtBar(project, bar) * 1000)
    const id = newId()
    edit([{ op: 'clip.put', clip: { id, lane_id: laneId, start_ms: start, length_ms: Math.max(1, end - start), notes: [] } }])
    setSel([id]); setRoll(id)
  }
  const file = useRef<HTMLInputElement>(null)

  // Keys while the DAW has focus (or nothing else does).
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement
      if (a && a !== document.body && !root.current?.contains(a)) return
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return
      if (roll && (e.key === 'Delete' || e.key === 'Backspace')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(Object.keys(clips)); return }
      if (mod || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); if (!live) play() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); del() } }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); split() }
      else if (e.key.toLowerCase() === 'l' && project?.loop_end_ms) { e.preventDefault(); edit([{ op: 'project', loop_on: !project.loop_on }]) }
      else if (e.key === 'Home') { e.preventDefault(); seek(0) }
      else if (e.key === 'Escape') { setSel([]); setRoll(null) }
      else if (e.key === 'Tab') { e.preventDefault(); changeView(view === 'arrange' ? 'mixer' : 'arrange') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const [bpmDraft, setBpmDraft] = useState<string | null>(null)
  const commitBpm = () => { const v = Math.round(Number(bpmDraft)); setBpmDraft(null); if (bpmDraft !== null && v >= 40 && v <= 300 && v !== bpm) void setStudioConfig(channel.id, { bpm: v }).catch((e) => pushToast((e as Error).message, 'error')) }
  const config = (patch: Parameters<typeof setStudioConfig>[1]) => setStudioConfig(channel.id, patch).catch((e) => pushToast((e as Error).message, 'error'))

  if (!project) return <div className="flex-1 min-h-0 flex items-center justify-center rounded-xl border border-line bg-bg-1 text-sm text-text-2" data-daw data-daw-state="loading">{error ? t('Couldn’t open the project: {error}', { error }) : loading ? t('Opening the project…') : null}</div>

  const state = live ? (Date.now() < Date.parse(live.started_at) ? 'count-in' : 'recording') : playing ? 'playing' : 'stopped'
  const bb = barBeat(project, head)
  const tb = 'h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40 disabled:hover:bg-transparent'
  const on = (x: boolean) => (x ? 'bg-accent/25 text-accent' : '')
  const hasLoop = !!project.loop_end_ms && project.loop_end_ms > (project.loop_start_ms ?? 0)
  const group = selected.length === 1 && selected[0].group_id ? Object.values(clips).filter((c) => c.group_id === selected[0].group_id).sort((a, b) => a.id.localeCompare(b.id)) : null
  const rollClip = roll ? clips[roll] : undefined
  const peerList = Object.entries(peers).filter(([, p]) => Date.now() - p.at < 15_000)
  const peerColor = (uid: string) => PEER_COLORS[Math.abs([...uid].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % PEER_COLORS.length]
  const recordable = crew || inBand
  return (
    <div ref={root} tabIndex={-1} className="relative flex-1 min-h-0 flex flex-col rounded-xl border border-line bg-bg-1 overflow-hidden outline-none" data-daw data-daw-state={state} data-daw-view={view}>
      {/* Control bar: project, tempo, transport, position, panels, view */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-bg-2">
        <ProjectMenu channel={channel} project={project} />
        <div className="flex shrink-0 items-center gap-1">
          <input value={bpmDraft ?? String(bpm)} onChange={(e) => setBpmDraft(e.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={commitBpm} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} inputMode="numeric" title={t('Tempo (BPM)')} aria-label={t('Tempo (BPM)')} className="input h-8 w-14 px-1 text-center font-mono text-sm tabular-nums" data-daw-bpm />
          <Dropdown value={beats} onChange={(e) => void config({ beats: Number(e.target.value) })} title={t('Time signature')} aria-label={t('Time signature')} className="input h-8 w-[4.5rem] px-2 text-sm" data-daw-beats>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
          </Dropdown>
          <button type="button" onClick={() => void config({ click: !cfg.click })} title={cfg.click ? t('Metronome: on') : t('Metronome: off')} aria-pressed={cfg.click} className={`h-8 w-8 rounded-md flex items-center justify-center ${cfg.click ? 'bg-warn text-black' : 'text-text-2 hover:bg-bg-3 hover:text-text-0'}`} data-daw-click><Metronome size={16} /></button>
          <Dropdown value={cfg.count_in} onChange={(e) => void config({ count_in: Number(e.target.value) })} title={t('Count-in')} aria-label={t('Count-in')} className="input h-8 w-20 px-1 text-sm" data-daw-countin>
            <option value={0}>{t('No count')}</option>
            {[1, 2, 4].map((n) => <option key={n} value={n}>{n === 1 ? t('1 bar') : t('{n} bars', { n })}</option>)}
          </Dropdown>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => seek(0)} disabled={!!live} title={t('Return to zero (Home)')} className={tb} data-daw-rtz><SkipBack size={18} /></button>
          <button type="button" onClick={play} disabled={!!live} title={playing ? t('Stop (Space)') : t('Play (Space)')} className={`${tb} h-9 w-9 ${playing === 'local' || playing === 'shared' ? 'text-success' : ''}`} aria-pressed={!!playing} data-daw-play>{playing === 'local' || playing === 'shared' ? <Square size={16} /> : <Play size={18} />}</button>
          {crew && <button type="button" onClick={() => void record(false)} disabled={busy || (!!live && live.solo && live.started_by !== me?.id)} title={live ? t('Stop recording') : t('Record the band from the playhead')} className={`h-9 w-9 rounded-md flex items-center justify-center disabled:opacity-40 ${live && !live.solo ? 'bg-danger text-white animate-pulse' : 'text-danger hover:bg-bg-3'}`} aria-pressed={!!live && !live.solo} data-daw-record>{live && !live.solo ? <Square size={14} fill="currentColor" /> : <span className="h-4 w-4 rounded-full bg-danger" />}</button>}
          {inBand && (!live || (live.solo && live.started_by === me?.id)) && <button type="button" onClick={() => void record(true)} disabled={busy} title={live ? t('Stop recording') : t('Record alone (only you record and hear it)')} className={`h-9 rounded-md px-2 text-[11px] font-bold disabled:opacity-40 ${live?.solo ? 'bg-danger text-white animate-pulse' : 'text-danger hover:bg-bg-3'}`} aria-pressed={!!live?.solo} data-daw-record-solo>{live?.solo ? t('Stop') : t('Solo ●')}</button>}
          <button type="button" onClick={() => edit([{ op: 'project', loop_on: !project.loop_on }])} disabled={!hasLoop} title={hasLoop ? t('Loop (L)') : t('Drag on the ruler to set a loop range')} aria-pressed={!!project.loop_on} className={`${tb} ${on(!!project.loop_on)}`} data-daw-loop><Repeat size={16} /></button>
          <button type="button" onClick={() => edit([{ op: 'project', punch_on: !project.punch_on }])} disabled={!hasLoop} title={t('Punch: recording keeps only the loop range')} aria-pressed={!!project.punch_on} className={`${tb} text-[10px] font-black ${on(!!project.punch_on)}`} data-daw-punch>P</button>
          <button type="button" onClick={() => setFollow(!follow)} title={follow ? t('Shared playback: you hear what anyone plays, and they hear what you play') : t('Playing on your own: turn on to follow the shared playback')} aria-pressed={follow} className={`${tb} ${on(follow)}`} data-daw-follow><Link2 size={15} /></button>
          {hasLoop && <button type="button" onClick={clearLoop} title={t('Clear the loop range')} className={`${tb} hover:text-danger`} data-daw-loop-clear><X size={14} /></button>}
        </div>
        <span className={`shrink-0 rounded-md bg-bg-0 px-2.5 py-1 font-mono text-lg tabular-nums ${live ? 'text-danger' : 'text-text-0'}`} data-daw-time>{timecode(head)}</span>
        <span className="shrink-0 rounded-md bg-bg-0 px-2 py-1.5 font-mono text-sm tabular-nums text-text-1" title={t('Bar.beat ({bpm} BPM)', { bpm: bb.bpm })} data-daw-beat>{bb.bar}.{bb.beat}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {peerList.length > 0 && <span className="flex -space-x-1.5" data-daw-peers>{peerList.slice(0, 5).map(([uid]) => users[uid] && <span key={uid} className="rounded-full ring-2" style={{ ['--tw-ring-color' as string]: peerColor(uid) }} title={users[uid].display_name ?? users[uid].username}><Avatar user={users[uid]} size={20} /></span>)}</span>}
          {!phone && <>
            <button type="button" onClick={undo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')} className={tb} data-daw-undo><Undo2 size={16} /></button>
            <button type="button" onClick={redo} disabled={!canRedo} title={t('Redo (Ctrl+Shift+Z)')} className={tb} data-daw-redo><Redo2 size={16} /></button>
          </>}
          <button type="button" onClick={() => setPanel(panel === 'band' ? null : 'band')} title={t('Band')} className={`${tb} ${on(panel === 'band')}`} data-daw-band-open><Users size={16} /></button>
          {!phone && <button type="button" onClick={() => setPanel(panel === 'sessions' ? null : 'sessions')} title={t('Sessions')} className={`${tb} ${on(panel === 'sessions')}`} data-daw-sessions-open><CalendarClock size={16} /></button>}
          <button type="button" onClick={() => setPanel(panel === 'takes' ? null : 'takes')} title={t('Takes')} className={`${tb} ${on(panel === 'takes')}`} data-daw-takes-open><Disc3 size={16} /></button>
          <button type="button" onClick={() => setPanel(panel === 'comments' ? null : 'comments')} title={t('Comments')} className={`${tb} relative ${on(panel === 'comments')}`} data-daw-comments-open><MessageSquare size={16} />{comments.some((c) => !c.resolved) && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-danger px-1 text-[9px] font-bold text-white">{comments.filter((c) => !c.resolved).length}</span>}</button>
          {!phone && <button type="button" onClick={() => setPanel(panel === 'versions' ? null : 'versions')} title={t('Versions')} className={`${tb} ${on(panel === 'versions')}`} data-daw-versions-open><History size={16} /></button>}
          <button type="button" onClick={() => setPanel(panel === 'export' ? null : 'export')} title={t('Export')} className={`${tb} ${on(panel === 'export')}`} data-daw-export-open><Download size={16} /></button>
          <span className="flex rounded-md bg-bg-0 p-0.5" role="tablist" aria-label={t('Console view')}>
            <button type="button" role="tab" aria-selected={view === 'arrange'} onClick={() => changeView('arrange')} title={t('Arrangement (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'arrange' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-daw-view-arrange><Rows3 size={16} /></button>
            <button type="button" role="tab" aria-selected={view === 'mixer'} onClick={() => changeView('mixer')} title={t('Mixer (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'mixer' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-daw-view-mixer><SlidersVertical size={16} /></button>
          </span>
          <button type="button" onClick={onClose} title={t('Close console')} className={tb} data-console-close><X size={18} /></button>
        </span>
      </div>
      {/* Edit bar: tracks, import, snap, zoom, MIDI input, markers, tempo, the selection */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-line bg-bg-2/60 text-xs">
        <button type="button" onClick={() => addLane('audio')} className="btn-ghost h-8 py-1 text-xs" title={t('New audio track')} data-daw-add-lane><Plus size={14} /> {t('Track')}</button>
        {!phone && <button type="button" onClick={() => addLane('midi')} className="btn-ghost h-8 py-1 text-xs" title={t('New MIDI track with an instrument')} data-daw-add-midi><Piano size={14} /> {t('MIDI')}</button>}
        {!phone && <button type="button" onClick={() => addLane('bus')} className="btn-ghost h-8 py-1 text-xs" title={t('New bus: tracks send to it, for shared reverb and the like')} data-daw-add-bus><Layers size={14} /> {t('Bus')}</button>}
        <button type="button" onClick={() => file.current?.click()} className="btn-ghost h-8 py-1 text-xs" title={t('Import audio files onto new tracks at the playhead')} data-daw-import><Upload size={14} /> {t('Import')}</button>
        <input ref={file} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.opus" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void importFiles(channel.id, fs, head * 1000) }} data-daw-file />
        {!phone && view === 'arrange' && <>
          <span className="mx-1 h-5 w-px bg-line" />
          <Magnet size={14} className={snap === 'off' ? 'text-text-2' : 'text-accent'} aria-hidden />
          <Dropdown value={snap} onChange={(e) => setSnap(e.target.value as Snap)} title={t('Snap to grid (hold Alt to move freely)')} aria-label={t('Snap')} className="input h-8 w-20 px-2 text-xs" data-daw-snap>
            <option value="bar">{t('Bar')}</option><option value="beat">{t('Beat')}</option><option value="half">{t('½ beat')}</option><option value="sixteenth">{t('1/16')}</option><option value="off">{t('Off')}</option>
          </Dropdown>
          <button type="button" onClick={() => zoom(1 / 1.5)} title={t('Zoom out')} className={tb} data-daw-zoom-out><ZoomOut size={16} /></button>
          <button type="button" onClick={() => zoom(1.5)} title={t('Zoom in')} className={tb} data-daw-zoom-in><ZoomIn size={16} /></button>
          <button type="button" onClick={() => edit([{ op: 'project', markers: [...(project.markers ?? []), { id: newId().slice(0, 8), ms: Math.round(head * 1000), name: t('Marker {n}', { n: (project.markers?.length ?? 0) + 1 }) }] }])} title={t('Add a marker at the playhead')} className={tb} data-daw-add-marker><Flag size={15} /></button>
          <button type="button" onClick={() => setPanel(panel === 'tempo' ? null : 'tempo')} title={t('Tempo changes')} className={`${tb} ${on(panel === 'tempo')}`} data-daw-tempo-open><Gauge size={15} /></button>
          <button type="button" onClick={() => useMidi.setState({ keys: !midi.keys })} title={midi.keys ? t('Computer keyboard plays the armed MIDI track (A–K, Z/X octave)') : t('Play the armed MIDI track from the computer keyboard')} aria-pressed={midi.keys} className={`${tb} ${on(midi.keys)}`} data-daw-keys><Keyboard size={15} /></button>
          <button type="button" onClick={() => void connectMidi().then((n) => pushToast(n.length ? t('MIDI: {names}', { names: n.join(', ') }) : t('No MIDI keyboard found'))).catch((e) => pushToast((e as Error).message, 'error'))} title={midi.devices.length ? midi.devices.join(', ') : t('Connect a MIDI keyboard')} className={`${tb} ${on(midi.devices.length > 0)}`} data-daw-midi-connect><Cable size={15} /></button>
        </>}
        {!phone && selected.length > 0 && <>
          <span className="mx-1 h-5 w-px bg-line" />
          <button type="button" onClick={split} title={t('Split at the playhead (S)')} className={tb} data-daw-split><Scissors size={15} /></button>
          <button type="button" onClick={duplicate} title={t('Duplicate (Ctrl+D)')} className={tb} data-daw-duplicate><Copy size={15} /></button>
          <button type="button" onClick={del} title={t('Delete (Del)')} className={`${tb} hover:text-danger`} data-daw-delete><Trash2 size={15} /></button>
          {selected.length === 1 && selected[0].notes && <button type="button" onClick={() => setRoll(selected[0].id)} title={t('Edit notes (double-click the clip)')} className={tb} data-daw-open-roll><Music size={15} /></button>}
          {group && group.length > 1 && <span className="flex items-center gap-1" data-daw-takes>
            <span className="text-text-2">{t('Take')}</span>
            {group.map((g, i) => <button key={g.id} type="button" onClick={() => edit(group.map((x): Op => ({ op: 'clip.put', clip: { id: x.id, muted: x.id !== g.id } })))} className={`h-6 w-6 rounded text-[11px] font-bold ${!g.muted ? 'bg-accent text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} data-daw-take={i + 1} aria-pressed={!g.muted}>{i + 1}</button>)}
          </span>}
          {selected.length === 1 && <ClipInspector clip={selected[0]} />}
        </>}
      </div>

      {view === 'arrange'
        ? <Arrangement {...{ channel, project, ordered, lanes, clips, audio, pps, head, live: !!live, liveSince: live ? (live.position_ms ?? 0) / 1000 : 0, liveSolo: live?.solo ? live.started_by : null, sel, setSel, seek, snapMs, band: band.map((b) => b.user_id), crew, users, phone, autoOpen, setAutoOpen, newMidiClip, setRoll, midiLane: midi.lane, peers: peerList, peerColor, comments, openComments: () => setPanel('comments') }} />
        : <DawMixer ordered={ordered} lanes={lanes} project={project} channelId={channel.id} users={users} />}
      {rollClip && lanes[rollClip.lane_id] && <PianoRoll clip={rollClip} lane={lanes[rollClip.lane_id]} project={project} close={() => setRoll(null)} />}
      {ordered.length === 0 && <p className="shrink-0 px-3 py-2 text-xs text-text-2" data-daw-empty>{recordable ? t('Record a take, import a backing track to record over, or add a MIDI track to write parts.') : t('Import a backing track, or ask an engineer to record a take.')}</p>}
      {panel === 'comments' && <CommentsPanel head={head} seek={seek} close={() => setPanel(null)} />}
      {panel === 'versions' && <VersionsPanel close={() => setPanel(null)} />}
      {panel === 'export' && <ExportPanel channel={channel} close={() => setPanel(null)} />}
      {panel === 'takes' && <TakesPanel channel={channel} head={head} close={() => setPanel(null)} />}
      {panel === 'band' && <BandPanel channel={channel} close={() => setPanel(null)} />}
      {panel === 'sessions' && <SessionsPanel channel={channel} close={() => setPanel(null)} />}
      {panel === 'tempo' && <TempoPanel project={project} head={head} close={() => setPanel(null)} />}
    </div>
  )
}

/** Tempo and time signature changes from a bar on. */
function TempoPanel({ project, head, close }: { project: StudioProject; head: number; close: () => void }) {
  const t = useT()
  const list = (project.tempo_map ?? []) as TempoChange[]
  const save = (next: TempoChange[]) => edit([{ op: 'project', tempo_map: next.filter((c) => c.bar >= 1).sort((a, b) => a.bar - b.bar) }])
  const here = barBeat(project, head)
  const num = 'input h-7 w-16 px-1 text-center font-mono text-xs'
  return (
    <FloatWindow id="panel-tempo" title={t('Tempo changes')} icon={<Gauge size={16} />} width={288} onClose={close} data-daw-panel="tempo">
      <p className="mb-2 text-xs text-text-2">{t('Bar 1: {bpm} BPM, {beats}/4 (the project tempo)', { bpm: project.bpm, beats: project.beats })}</p>
      {list.map((c, i) => (
        <div key={i} className="mb-1 flex items-center gap-1 text-xs" data-daw-tempo-change={c.bar + 1}>
          <span className="text-text-2">{t('Bar')}</span><input type="number" min={2} value={c.bar + 1} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, bar: Math.max(1, Number(e.target.value) - 1) } : x)))} className={num} />
          <input type="number" min={40} max={300} value={c.bpm} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, bpm: Math.max(40, Math.min(300, Number(e.target.value) || 120)) } : x)))} className={num} aria-label={t('BPM')} />
          <Dropdown value={c.beats} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, beats: Number(e.target.value) } : x)))} className="input h-7 w-16 px-1 text-xs">{[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}</Dropdown>
          <button type="button" onClick={() => save(list.filter((_, j) => j !== i))} className="text-text-2 hover:text-danger"><Trash2 size={13} /></button>
        </div>
      ))}
      <button type="button" onClick={() => { const bar = Math.max(1, here.bar - 1 + (here.beat > 1 ? 1 : 0)); save([...list.filter((c) => c.bar !== bar), { bar: Math.max(1, bar), bpm: here.bpm, beats: here.beats }]) }} className="btn-ghost mt-1 h-8 w-full justify-center py-0 text-xs" data-daw-tempo-add><Plus size={13} /> {t('Change at bar {n}', { n: Math.max(2, here.bar + (here.beat > 1 ? 1 : 0)) })}</button>
    </FloatWindow>
  )
}

/** The project name, with switching, new, rename and delete. */
/** The project: its name and stage, and (for whoever may) rename, tag, archive, the band, back to the studio, delete. */
function ProjectMenu({ channel, project }: { channel: Channel; project: StudioProject }) {
  const t = useT()
  const navigate = useNavigate()
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const rights = projectRights(channel)
  const tag = tagOf(project.tag)
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  const patch = (body: Parameters<typeof updateProject>[1]) => { setOpen(false); updateProject(project.id, body).catch(fail) }
  const studio = () => { if (channel.parent_id) navigate(`/channels/${channel.guild_id}/${channel.parent_id}`) }
  const remove = () => { setOpen(false); openModal({ kind: 'confirm', title: t('Delete {name}', { name: project.name }), body: t('Deletes the project and everything in it: its tracks, takes, imported audio, chat, comments and versions. This cannot be undone.'), danger: true, confirmLabel: t('Delete'), action: async () => { try { await deleteProject(project.id); studio() } catch (e) { fail(e) } } }) }
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-3'
  if (renaming !== null) return <input autoFocus value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} onBlur={() => { if (renaming.trim() && renaming !== project.name) updateProject(project.id, { name: renaming.trim() }).catch(fail); setRenaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} className="input h-8 w-48 text-sm" data-daw-rename-input />
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} onDoubleClick={() => rights.manage && setRenaming(project.name)} className="flex h-8 max-w-56 items-center gap-1.5 rounded-md bg-bg-0 px-2.5 text-sm font-semibold hover:bg-bg-3" title={rights.manage ? t('Project (double-click to rename)') : t('Project')} aria-expanded={open} data-daw-project>
        <FolderOpen size={15} className="shrink-0 text-accent" /><span className="truncate" data-daw-project-name>{project.name}</span>
        {tag && <span className={`shrink-0 rounded px-1 text-[10px] font-bold uppercase ${tag.cls}`} data-daw-project-tag>{t(tag.label)}</span>}
        {project.archived_at && <Archive size={13} className="shrink-0 text-text-2" aria-label={t('Archived')} />}
        <ChevronDown size={14} className="shrink-0 text-text-2" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="pop absolute left-0 top-9 z-50 w-60 rounded-lg border border-line bg-bg-1 p-1 shadow-xl" role="menu" data-daw-projects>
            {channel.parent_id && <button type="button" onClick={() => { setOpen(false); studio() }} className={item} data-daw-back-studio><ArrowLeft size={14} /> {t('All projects')}</button>}
            {rights.manage && <>
              <button type="button" onClick={() => { setOpen(false); setRenaming(project.name) }} className={item} data-daw-rename><Pencil size={14} /> {t('Rename…')}</button>
              <div className="my-1 h-px bg-line" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-2">{t('Stage')}</p>
              <div className="flex flex-wrap gap-1 px-2 pb-1">
                {TAGS.map((x) => <button key={x.id} type="button" onClick={() => patch({ tag: project.tag === x.id ? '' : x.id })} aria-pressed={project.tag === x.id} className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${project.tag === x.id ? x.cls : 'bg-bg-3 text-text-2 hover:text-text-0'}`} data-daw-tag={x.id}>{t(x.label)}</button>)}
              </div>
              <div className="my-1 h-px bg-line" />
              <button type="button" onClick={() => patch({ archived: !project.archived_at })} className={item} data-daw-archive><Archive size={14} /> {project.archived_at ? t('Unarchive') : t('Archive')}</button>
            </>}
            {rights.remove && <button type="button" onClick={remove} className={`${item} text-danger hover:bg-danger/10`} data-daw-delete-project><Trash2 size={14} /> {t('Delete project')}</button>}
          </div>
        </>
      )}
    </div>
  )
}

/** The selected clip's gain and fades. */
function ClipInspector({ clip }: { clip: StudioClip }) {
  const t = useT()
  const num = 'input h-7 w-16 px-1 text-center font-mono text-xs tabular-nums'
  return (
    <span className="flex items-center gap-1.5" data-daw-inspector={clip.id}>
      <label className="flex items-center gap-1 text-text-2" title={t('Clip gain')}>{t('Gain')}
        <input type="range" min={0} max={200} value={Math.round(clip.gain * 100)} onChange={(e) => editLive(`gain:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, gain: Number(e.target.value) / 100 } }])} onDoubleClick={() => edit([{ op: 'clip.put', clip: { id: clip.id, gain: 1 } }])} className="w-20 accent-accent" data-daw-clip-gain />
        <span className="w-12 font-mono tabular-nums">{dB(clip.gain)} dB</span>
      </label>
      {!clip.notes && <>
        <label className="flex items-center gap-1 text-text-2" title={t('Fade in (ms)')}>{t('In')}<input type="number" min={0} step={50} value={clip.fade_in_ms} onChange={(e) => editLive(`fi:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, fade_in_ms: Math.max(0, Math.min(clip.length_ms, Number(e.target.value) || 0)) } }])} className={num} data-daw-fade-in /></label>
        <label className="flex items-center gap-1 text-text-2" title={t('Fade out (ms)')}>{t('Out')}<input type="number" min={0} step={50} value={clip.fade_out_ms} onChange={(e) => editLive(`fo:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, fade_out_ms: Math.max(0, Math.min(clip.length_ms, Number(e.target.value) || 0)) } }])} className={num} data-daw-fade-out /></label>
      </>}
      <button type="button" onClick={() => edit([{ op: 'clip.put', clip: { id: clip.id, muted: !clip.muted } }])} aria-pressed={clip.muted} className={`h-7 rounded px-2 text-[11px] font-bold ${clip.muted ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} data-daw-clip-mute>{t('Mute clip')}</button>
    </span>
  )
}

type ArrProps = {
  channel: Channel; project: StudioProject; ordered: StudioLane[]; lanes: Record<string, StudioLane>; clips: Record<string, StudioClip>; audio: Record<string, StudioTrack>
  pps: number; head: number; live: boolean; liveSince: number; liveSolo: string | null; sel: string[]; setSel: (s: string[] | ((s: string[]) => string[])) => void
  seek: (sec: number) => void; snapMs: (ms: number, free?: boolean) => number; band: string[]; crew: boolean
  users: Record<string, User>; phone: boolean; autoOpen: Record<string, string>; setAutoOpen: (f: (m: Record<string, string>) => Record<string, string>) => void
  newMidiClip: (lane: string, ms: number) => void; setRoll: (id: string | null) => void; midiLane: string | null
  peers: [string, { pos_ms: number; playing: boolean; sel: string[] }][]; peerColor: (uid: string) => string
  comments: import('../lib/daw').StudioComment[]; openComments: () => void
}

/** No loop range any more: loop and punch off. */
const clearLoop = () => edit([{ op: 'project', clear_loop: true }])

function Arrangement(p: ArrProps) {
  const t = useT()
  const { project, ordered, lanes, clips, pps, head, sel, setSel, snapMs, phone, autoOpen } = p
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropLane, setDropLane] = useState<string | 'new' | null>(null)
  const [loopDrag, setLoopDrag] = useState<{ a: number; b: number; x0: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const total = Math.max(120, projectEnd(clips) / 1000 + 30, head + 30)
  const width = Math.ceil(total * pps)
  const barsAll = barList(project, total)
  const minBar = barsAll.length > 1 ? Math.min(...barsAll.slice(1).map((b, i) => b.sec - barsAll[i].sec)) : 2
  // Ruler: a label every n bars so they don't crowd.
  const every = [1, 2, 4, 8, 16, 32].find((n) => n * minBar * pps >= 48) ?? 64
  const msAt = (clientX: number) => { const r = scroller.current!.getBoundingClientRect(); return Math.max(0, ((clientX - r.left + scroller.current!.scrollLeft) / pps) * 1000) }
  const laneAt = (clientY: number) => (document.elementsFromPoint(scroller.current!.getBoundingClientRect().left + 4, clientY).find((e) => (e as HTMLElement).dataset?.dawLane) as HTMLElement | undefined)?.dataset.dawLane ?? null
  const peerSel = new Map<string, string>()
  for (const [uid, x] of p.peers) for (const id of x.sel) peerSel.set(id, p.peerColor(uid))

  // Follow the playhead while playing.
  useEffect(() => {
    const s = scroller.current
    if (!s) return
    const x = head * pps
    if (x > s.scrollLeft + s.clientWidth - 40 || x < s.scrollLeft) s.scrollLeft = Math.max(0, x - 80)
  }, [Math.floor(head * pps / 200)]) // eslint-disable-line react-hooks/exhaustive-deps

  /** What a drag would make of a clip. */
  const dragged = (c: StudioClip): StudioClip => {
    if (!drag || !drag.ids.includes(c.id)) return c
    const d = drag.dms
    if (drag.mode === 'move') { const to = drag.ids.length === 1 && drag.lane ? drag.lane : c.lane_id; return { ...c, start_ms: Math.max(0, Math.round(c.start_ms + d)), lane_id: lanes[to]?.kind === (lanes[c.lane_id]?.kind ?? 'audio') ? to : c.lane_id } }
    const len = c.notes ? Infinity : (c.audio_id ? p.audio[c.audio_id]?.duration_ms : null) ?? Infinity
    if (drag.mode === 'trimL') { const dd = Math.max(c.notes ? -c.start_ms : -c.in_ms, -c.start_ms, Math.min(c.length_ms - 20, d)); return { ...c, start_ms: Math.round(c.start_ms + dd), in_ms: c.notes ? 0 : Math.round(c.in_ms + dd), length_ms: Math.round(c.length_ms - dd), fade_in_ms: Math.min(c.fade_in_ms, c.length_ms - dd), ...(c.notes ? { notes: (c.notes as Note[]).map((n) => ({ ...n, t: n.t - Math.round(dd) })).filter((n) => n.t >= 0) } : {}) } }
    if (drag.mode === 'trimR') { const nl = Math.max(20, Math.min(len - c.in_ms, c.length_ms + d)); return { ...c, length_ms: Math.round(nl), fade_out_ms: Math.min(c.fade_out_ms, nl) } }
    if (drag.mode === 'fadeIn') return { ...c, fade_in_ms: Math.round(Math.max(0, Math.min(c.length_ms - c.fade_out_ms, c.fade_in_ms + d))) }
    return { ...c, fade_out_ms: Math.round(Math.max(0, Math.min(c.length_ms - c.fade_in_ms, c.fade_out_ms - d))) }
  }

  const begin = (e: RPointerEvent, c: StudioClip, mode: Drag['mode']) => {
    if (phone || e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    const ids = mode === 'move' ? (sel.includes(c.id) ? sel : e.shiftKey ? [...sel, c.id] : [c.id]) : [c.id]
    if (!sel.includes(c.id) || mode !== 'move') setSel(e.shiftKey && mode === 'move' ? ids : ids.length > 1 ? ids : [c.id])
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ ids, mode, x0: e.clientX, lane0: c.lane_id, dms: 0, lane: null, copy: e.altKey && mode === 'move' })
  }
  const moveDrag = (e: RPointerEvent) => {
    if (!drag) return
    const raw = ((e.clientX - drag.x0) / pps) * 1000
    const first = clips[drag.ids[0]]
    // Snap the clip's edge to the grid, not the distance moved.
    const edge = drag.mode === 'trimR' ? clipEnd(first) : drag.mode === 'fadeIn' || drag.mode === 'fadeOut' ? 0 : first.start_ms
    const dms = drag.mode === 'fadeIn' || drag.mode === 'fadeOut' ? raw : snapMs(edge + raw, e.altKey) - edge
    setDrag({ ...drag, dms, lane: drag.mode === 'move' ? laneAt(e.clientY) : null })
  }
  const endDrag = () => {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (Math.abs(d.dms) < 1 && (!d.lane || d.lane === d.lane0)) return
    const out = d.ids.map((id) => clips[id]).filter(Boolean).map((c) => dragged(c))
    if (d.copy) { const made = out.map((c) => ({ ...c, id: newId() })); edit(made.map((c): Op => ({ op: 'clip.put', clip: { ...c, group_id: '' as unknown as null } }))); setSel(made.map((c) => c.id)); return }
    edit(out.map((c): Op => ({ op: 'clip.put', clip: { id: c.id, lane_id: c.lane_id, start_ms: c.start_ms, in_ms: c.in_ms, length_ms: c.length_ms, fade_in_ms: c.fade_in_ms, fade_out_ms: c.fade_out_ms, ...(c.notes && d.mode === 'trimL' ? { notes: c.notes } : {}) } })))
  }

  const onDrop = (e: React.DragEvent, lane: string | null) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac|webm|opus)$/i.test(f.name))
    setDropLane(null)
    if (!files.length) return
    e.preventDefault()
    void importFiles(p.channel.id, files, snapMs(msAt(e.clientX)), lane && lanes[lane]?.kind === 'audio' ? lane : undefined)
  }

  // The ruler: click to move the playhead, drag to set the loop range.
  const rulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const ms = snapMs(msAt(e.clientX), e.altKey)
    setLoopDrag({ a: ms, b: ms, x0: e.clientX })
  }
  const rulerMove = (e: RPointerEvent<HTMLDivElement>) => { if (loopDrag) setLoopDrag({ ...loopDrag, b: snapMs(msAt(e.clientX), e.altKey) }) }
  const rulerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const l = loopDrag
    setLoopDrag(null)
    if (!l) return
    if (Math.abs(e.clientX - l.x0) < 5 || Math.abs(l.b - l.a) < 50) { p.seek(l.a / 1000); return }
    edit([{ op: 'project', loop_start_ms: Math.round(Math.min(l.a, l.b)), loop_end_ms: Math.round(Math.max(l.a, l.b)), loop_on: true }])
  }
  const loopA = loopDrag ? Math.min(loopDrag.a, loopDrag.b) : project.loop_start_ms ?? 0
  const loopB = loopDrag ? Math.max(loopDrag.a, loopDrag.b) : project.loop_end_ms ?? 0
  const showLoop = loopB > loopA + 1

  const rowH = (l: StudioLane) => LANE_H + (autoOpen[l.id] ? AUTO_H : 0)
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-daw-arrangement>
      <div className="flex min-h-full">
        <div className="w-56 phone:w-32 shrink-0 border-r border-line bg-bg-2/60">
          <div className="sticky top-0 z-10 h-7 border-b border-line bg-bg-2" />
          {ordered.map((l, i) => <LaneHead key={l.id} l={l} i={i} {...p} />)}
          {/* Recording members without a lane yet: theirs is made when the take lands. */}
          {p.live && p.band.filter((u) => !ordered.some((l) => l.user_id === u) && (!p.liveSolo || p.liveSolo === u)).map((u) => (
            <div key={u} className="flex items-center gap-1.5 border-b border-line/60 pl-3 pr-2 text-sm opacity-80" style={{ height: LANE_H }} data-daw-lane-pending={u}>
              {p.users[u] && <Avatar user={p.users[u]} size={18} />}
              <span className="min-w-0 truncate font-semibold">{p.users[u]?.display_name ?? p.users[u]?.username ?? ''}</span>
              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase text-danger">{t('Rec')}</span>
            </div>
          ))}
        </div>
        <div ref={scroller} className="relative flex-1 min-w-0 overflow-x-auto" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropLane(laneAt(e.clientY) ?? 'new') } }} onDragLeave={() => setDropLane(null)} onDrop={(e) => onDrop(e, laneAt(e.clientY))} data-daw-timeline>
          <div className="relative" style={{ width }}>
            <div className="sticky top-0 z-10 h-7 cursor-pointer border-b border-line bg-bg-2 text-[10px] text-text-2 select-none" onPointerDown={rulerDown} onPointerMove={rulerMove} onPointerUp={rulerUp} onDoubleClick={(e) => { const ms = msAt(e.clientX); if (showLoop && ms >= loopA && ms <= loopB) clearLoop() }} title={t('Drag to set a loop range · double-click it to clear')} data-daw-ruler>
              {showLoop && <div className={`pointer-events-none absolute inset-y-0 border-x ${project.loop_on || loopDrag ? 'border-accent bg-accent/25' : 'border-text-2/50 bg-text-2/10'}`} style={{ left: (loopA / 1000) * pps, width: ((loopB - loopA) / 1000) * pps }} data-daw-loop-range={project.loop_on ? 'on' : 'off'} />}
              {barsAll.filter((b) => b.bar % every === 0).map((b) => <span key={b.bar} className="absolute top-0 h-full border-l border-line pl-1 leading-7" style={{ left: b.sec * pps }}>{b.bar + 1}</span>)}
              {(project.tempo_map ?? []).map((c) => <span key={`t${c.bar}`} className="absolute bottom-0 rounded-t bg-bg-4 px-1 text-[9px] font-bold text-text-1" style={{ left: secAtBar(project, c.bar) * pps + 2 }} title={t('{bpm} BPM, {beats}/4 from bar {bar}', { bpm: c.bpm, beats: c.beats, bar: c.bar + 1 })}>{c.bpm}{c.beats !== project.beats ? ` ${c.beats}/4` : ''}</span>)}
              {(project.markers ?? []).map((m) => (
                <span key={m.id} className="absolute top-0 z-10 flex h-3.5 max-w-32 items-center gap-0.5 truncate rounded-br bg-warn px-1 text-[9px] font-bold text-black" style={{ left: (m.ms / 1000) * pps }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.altKey) edit([{ op: 'project', markers: (project.markers ?? []).filter((x) => x.id !== m.id) }]); else p.seek(m.ms / 1000) }}
                  onDoubleClick={() => { const name = window.prompt(t('Marker name'), m.name); if (name !== null) edit([{ op: 'project', markers: (project.markers ?? []).map((x) => (x.id === m.id ? { ...x, name } : x)) }]) }} title={t('{name} (click to go, double-click to rename, Alt-click to remove)', { name: m.name })} data-daw-marker={m.id}>{m.name}</span>
              ))}
              {p.comments.filter((c) => !c.resolved).map((c) => <span key={c.id} className="absolute bottom-0 z-10 flex h-3 w-3 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-[7px] text-white" style={{ left: (c.ms / 1000) * pps }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { p.seek(c.ms / 1000); p.openComments() }} title={c.body} data-daw-comment-pin={c.id}>●</span>)}
            </div>
            <div className="relative" onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.dawLane) { setSel([]); p.seek(snapMs(msAt(e.clientX), e.altKey) / 1000) } }}>
              {barsAll.map((b) => <div key={b.bar} className={`pointer-events-none absolute top-0 bottom-0 w-px ${b.bar % every === 0 ? 'bg-line/70' : 'bg-line/25'}`} style={{ left: b.sec * pps }} />)}
              {showLoop && project.loop_on && <div className="pointer-events-none absolute top-0 bottom-0 bg-accent/5" style={{ left: (loopA / 1000) * pps, width: ((loopB - loopA) / 1000) * pps }} />}
              {ordered.map((l, i) => (
                <div key={l.id} style={{ height: rowH(l) }} className="border-b border-line/60">
                  <div className={`relative ${dropLane === l.id ? 'bg-accent/10' : ''} ${l.kind === 'bus' ? 'bg-bg-0/30' : ''}`} style={{ height: LANE_H }} data-daw-lane={l.id} data-lane-kind={l.kind}
                    onDoubleClick={(e) => { if (l.kind === 'midi' && (e.target as HTMLElement).dataset.dawLane && !phone) p.newMidiClip(l.id, msAt(e.clientX)) }}>
                    {Object.values(clips).filter((c) => dragged(c).lane_id === l.id && (!c.group_id || !c.muted)).map((c) => <Region key={c.id} c={dragged(c)} lane={l} color={laneColor(l, i)} pps={pps} selected={sel.includes(c.id)} peer={peerSel.get(c.id)} takes={c.group_id ? Object.values(clips).filter((x) => x.group_id === c.group_id).length : 0} dim={!audible(lanes, l.id) || c.muted} name={c.audio_id ? p.audio[c.audio_id]?.name ?? p.audio[c.audio_id]?.display_name ?? '' : l.name} begin={begin} move={moveDrag} end={endDrag} phone={phone} openRoll={() => p.setRoll(c.id)} onSelect={(e) => { if (phone) setSel([c.id]); else if (!drag) setSel(e.shiftKey ? (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id]) }} />)}
                    {p.live && l.user_id && p.band.includes(l.user_id) && (!p.liveSolo || p.liveSolo === l.user_id) && l.kind === 'audio' && head > p.liveSince && <div className="pointer-events-none absolute inset-y-2 rounded-md border border-danger bg-danger/20" style={{ left: p.liveSince * pps, width: (head - p.liveSince) * pps }} data-daw-recording={l.id} />}
                  </div>
                  {autoOpen[l.id] && (() => { const prm = paramOf(l, lanes, autoOpen[l.id]); return prm ? <AutoRow lane={l} param={prm} pps={pps} width={width} height={AUTO_H} snapMs={snapMs} /> : null })()}
                </div>
              ))}
              {p.live && p.band.filter((u) => !ordered.some((l) => l.user_id === u) && (!p.liveSolo || p.liveSolo === u)).map((u) => (
                <div key={u} className="relative border-b border-line/60 opacity-80" style={{ height: LANE_H }}>
                  {head > p.liveSince && <div className="pointer-events-none absolute inset-y-2 rounded-md border border-danger bg-danger/20" style={{ left: p.liveSince * pps, width: (head - p.liveSince) * pps }} />}
                </div>
              ))}
              <div className={`h-16 ${dropLane === 'new' ? 'bg-accent/10' : ''}`} data-daw-lane-new>{dropLane === 'new' && <span className="block pt-5 text-center text-xs text-accent">{t('Drop to import onto a new track')}</span>}</div>
              {p.peers.map(([uid, x]) => <div key={uid} className="pointer-events-none absolute -top-7 bottom-0 z-10 w-px opacity-80" style={{ left: (x.pos_ms / 1000) * pps, background: p.peerColor(uid) }} data-daw-peer-head={uid}><span className="absolute -top-0 left-0.5 whitespace-nowrap rounded px-1 text-[9px] font-bold text-black" style={{ background: p.peerColor(uid) }}>{p.users[uid]?.display_name ?? p.users[uid]?.username ?? ''}</span></div>)}
              <div className={`pointer-events-none absolute -top-7 bottom-0 z-20 w-px ${p.live ? 'bg-danger' : 'bg-text-0'}`} style={{ left: head * pps }} data-daw-playhead />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LaneHead({ l, i, lanes, clips, band, channel, users, phone, autoOpen, setAutoOpen, midiLane }: ArrProps & { l: StudioLane; i: number }) {
  const t = useT()
  const [naming, setNaming] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const owner = l.user_id ? users[l.user_id] : undefined
  const inBand = !!l.user_id && band.includes(l.user_id)
  const armed = !!l.armed
  const has = Object.values(clips).some((c) => c.lane_id === l.id)
  const params = autoParams(l, lanes)
  // Band members choose which track their takes land on.
  const me = useStore((s) => s.user)
  const rights = projectRights(channel)
  const mine = !!me && (rights.engineer || rights.artist)
  const myLane = mine && takeLane(lanes, me!.id)?.id === l.id
  const btn = (on: boolean, cls: string) => `h-5 w-5 shrink-0 rounded text-[10px] font-bold ${on ? cls : 'bg-bg-3 text-text-2 hover:text-text-0'}`
  return (
    <div style={{ height: LANE_H + (autoOpen[l.id] ? AUTO_H : 0) }} className="border-b border-line/60">
      <div className={`group relative flex flex-col justify-center gap-1 pl-3 pr-2 ${audible(lanes, l.id) ? '' : 'opacity-60'}`} style={{ height: LANE_H }} data-daw-lane-head={l.id} data-lane-kind={l.kind}>
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: laneColor(l, i) }} aria-hidden />
        <div className="flex min-w-0 items-center gap-1.5">
          {owner ? <Avatar user={owner} size={18} /> : l.kind === 'midi' ? <Piano size={14} className="shrink-0 text-text-2" /> : l.kind === 'bus' ? <Layers size={14} className="shrink-0 text-text-2" /> : null}
          {naming !== null
            ? <input autoFocus value={naming} maxLength={80} onChange={(e) => setNaming(e.target.value)} onBlur={() => { if (naming.trim() && naming !== l.name) edit([{ op: 'lane.put', lane: { id: l.id, name: naming.trim() } }]); setNaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNaming(null) }} className="input h-6 min-w-0 flex-1 px-1 text-sm" aria-label={t('Track name')} data-daw-lane-name-input />
            : <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={t('{name} (double-click to rename)', { name: l.name })} onDoubleClick={() => setNaming(l.name)} data-daw-lane-name>{l.name}</span>}
          {!phone && <button type="button" onClick={() => setMenu(!menu)} title={t('Track settings')} className="h-5 w-5 shrink-0 rounded text-text-2 hover:bg-bg-3 hover:text-text-0" data-daw-lane-menu>⋯</button>}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, mute: !l.mute } }])} title={t('Mute')} aria-pressed={l.mute} className={btn(l.mute, 'bg-danger text-white')} data-daw-mute={l.id}>M</button>
          {l.kind !== 'bus' && <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, solo: !l.solo } }])} title={t('Solo')} aria-pressed={l.solo} className={btn(l.solo, 'bg-warn text-black')} data-daw-solo={l.id}>S</button>}
          {l.kind === 'audio' && <button type="button" disabled={!rights.edit} onClick={(e) => armLane(l.id, !armed, e.ctrlKey || e.metaKey)} title={armed ? t('Armed: records the next take') : t('Arm (Ctrl-click to arm several)')} aria-pressed={armed} className={btn(armed, 'bg-danger text-white')} data-daw-arm={l.id}>R</button>}
          {mine && l.kind === 'audio' && <button type="button" onClick={(e) => armLane(l.id, true, e.ctrlKey || e.metaKey, me!.id)} title={myLane ? t('Your takes land on this track') : t('Record your takes on this track')} aria-pressed={myLane} className={btn(myLane, 'bg-accent text-white')} data-daw-rec-here={l.id}><Mic size={11} className="mx-auto" /></button>}
          {l.kind === 'midi' && !phone && <button type="button" onClick={() => armMidi(midiLane === l.id ? null : l.id)} title={midiLane === l.id ? t('Playing and recording MIDI here (on this device)') : t('Play and record MIDI on this track')} aria-pressed={midiLane === l.id} className={btn(midiLane === l.id, 'bg-danger text-white')} data-daw-midi-arm={l.id}>●</button>}
          {!phone && <button type="button" onClick={() => setAutoOpen((m) => { const n = { ...m }; if (n[l.id]) delete n[l.id]; else n[l.id] = Object.keys(l.automation ?? {})[0] ?? 'gain'; return n })} title={t('Automation')} aria-pressed={!!autoOpen[l.id]} className={btn(!!autoOpen[l.id] || Object.keys(l.automation ?? {}).length > 0, 'bg-warn/80 text-black')} data-daw-auto-toggle={l.id}><Activity size={11} className="mx-auto" /></button>}
          <input type="range" min={0} max={150} value={Math.round(l.gain * 100)} onChange={(e) => editLive(`gain:${l.id}`, [{ op: 'lane.put', lane: { id: l.id, gain: Number(e.target.value) / 100 } }])} onDoubleClick={() => edit([{ op: 'lane.put', lane: { id: l.id, gain: 1 } }])} title={t('Volume {db} dB', { db: dB(l.gain) })} aria-label={t('Volume')} className="ml-1 h-3 min-w-0 flex-1 accent-accent" data-daw-lane-gain={l.id} />
        </div>
        <Meter get={() => engine.level(l.id) || (l.user_id && inBand ? voice.level(l.user_id) : 0)} id={l.id} />
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="pop absolute left-full top-0 z-40 ml-1 w-56 rounded-lg border border-line bg-bg-1 p-2 text-xs shadow-xl" data-daw-lane-settings={l.id}>
              <div className="mb-2 flex flex-wrap gap-1">{['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#00b0f4', '#9b59b6', '#1abc9c'].map((c) => <button key={c} type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, color: c } }])} className={`h-5 w-5 rounded-full ${l.color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} aria-label={c} />)}</div>
              {l.kind !== 'bus' && <label className="mb-2 flex items-center gap-2" title={t('Shift the whole track earlier (−) or later (+) to fix timing')}>{t('Nudge')}<input type="number" min={-1000} max={1000} step={5} value={l.nudge_ms ?? 0} onChange={(e) => editLive(`nudge:${l.id}`, [{ op: 'lane.put', lane: { id: l.id, nudge_ms: Math.max(-1000, Math.min(1000, Math.round(Number(e.target.value) || 0))) } }])} className="input h-7 w-20 px-1 text-center font-mono text-xs" data-daw-nudge={l.id} />ms</label>}
              <button type="button" onClick={() => { setMenu(false); edit([{ op: 'lane.del', id: l.id }]) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger hover:bg-danger/10" data-daw-lane-delete><Trash2 size={13} /> {has ? t('Delete track and its clips') : t('Delete track')}</button>
            </div>
          </>
        )}
      </div>
      {autoOpen[l.id] && (
        <div className="flex items-center gap-1 bg-bg-0/40 px-2" style={{ height: AUTO_H }}>
          <Dropdown value={autoOpen[l.id]} onChange={(e) => setAutoOpen((m) => ({ ...m, [l.id]: e.target.value }))} className="input h-7 min-w-0 flex-1 px-1 text-[10px]" aria-label={t('Automated parameter')} data-daw-auto-param={l.id}>
            {params.map((x) => <option key={x.key} value={x.key}>{l.automation?.[x.key] ? '● ' : ''}{x.label}</option>)}
          </Dropdown>
          {l.automation?.[autoOpen[l.id]] && <button type="button" onClick={() => { const a = { ...l.automation }; delete a[autoOpen[l.id]]; edit([{ op: 'lane.put', lane: { id: l.id, automation: a } }]) }} title={t('Clear this automation')} className="text-text-2 hover:text-danger" data-daw-auto-clear><Trash2 size={12} /></button>}
        </div>
      )}
    </div>
  )
}

/** A clip: its waveform or notes, fades, takes, and handles to trim and fade. */
function Region({ c, lane, color, pps, selected, peer, takes, dim, name, begin, move, end, onSelect, phone, openRoll }: { c: StudioClip; lane: StudioLane; color: string; pps: number; selected: boolean; peer?: string; takes: number; dim: boolean; name: string; begin: (e: RPointerEvent, c: StudioClip, mode: Drag['mode']) => void; move: (e: RPointerEvent) => void; end: () => void; onSelect: (e: React.MouseEvent) => void; phone: boolean; openRoll: () => void }) {
  const t = useT()
  const w = Math.max(2, (c.length_ms / 1000) * pps)
  const fi = (c.fade_in_ms / 1000) * pps, fo = (c.fade_out_ms / 1000) * pps
  const h = LANE_H - 12
  const midi = !!c.notes
  return (
    <div className={`absolute top-1.5 overflow-hidden rounded-md border ${selected ? 'ring-2 ring-white/80' : ''} ${dim ? 'opacity-45' : ''} ${phone ? '' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ left: ((c.start_ms + (lane.nudge_ms ?? 0)) / 1000) * pps, width: w, height: h, borderColor: color, background: `${color}33`, color, boxShadow: peer ? `0 0 0 2px ${peer}` : undefined }}
      onPointerDown={(e) => begin(e, c, 'move')} onPointerMove={move} onPointerUp={end} onClick={onSelect} onDoubleClick={() => { if (midi && !phone) openRoll() }} data-daw-clip={c.id} data-clip-kind={midi ? 'midi' : 'audio'} data-selected={selected ? '1' : undefined}>
      {midi ? <ClipNotes c={c} /> : <ClipWave c={c} />}
      <span className="pointer-events-none absolute left-1.5 top-0.5 max-w-[calc(100%-12px)] truncate text-[10px] font-semibold text-text-0/90">{name}{c.gain !== 1 ? ` · ${dB(c.gain)} dB` : ''}{takes > 1 ? ` · ${t('{n} takes', { n: takes })}` : ''}</span>
      {!midi && <svg className="pointer-events-none absolute inset-0" width={w} height={h} aria-hidden>
        {fi > 0 && <path d={`M0 ${h} L${fi} 0 L0 0 Z`} fill="rgba(0,0,0,.35)" />}
        {fo > 0 && <path d={`M${w} ${h} L${w - fo} 0 L${w} 0 Z`} fill="rgba(0,0,0,.35)" />}
      </svg>}
      {!phone && <>
        <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => begin(e, c, 'trimL')} onPointerMove={move} onPointerUp={end} data-daw-trim-left />
        <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => begin(e, c, 'trimR')} onPointerMove={move} onPointerUp={end} data-daw-trim-right />
        {!midi && <>
          <span className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 cursor-pointer rounded-full border border-white bg-black/60" style={{ left: Math.max(5, fi) }} onPointerDown={(e) => begin(e, c, 'fadeIn')} onPointerMove={move} onPointerUp={end} title={t('Fade in')} data-daw-fade-in-handle />
          <span className="absolute top-0 h-2.5 w-2.5 translate-x-1/2 cursor-pointer rounded-full border border-white bg-black/60" style={{ right: Math.max(5, fo) }} onPointerDown={(e) => begin(e, c, 'fadeOut')} onPointerMove={move} onPointerUp={end} title={t('Fade out')} data-daw-fade-out-handle />
        </>}
      </>}
    </div>
  )
}

/** A MIDI clip's notes in miniature. */
function ClipNotes({ c }: { c: StudioClip }) {
  const notes = (c.notes ?? []) as Note[]
  if (!notes.length) return <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] text-text-2">♪</span>
  const lo = Math.min(...notes.map((n) => n.p)), hi = Math.max(...notes.map((n) => n.p))
  const span = Math.max(12, hi - lo + 1)
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${c.length_ms} ${span}`} preserveAspectRatio="none" aria-hidden data-daw-notes={notes.length}>
      {notes.map((n, i) => <rect key={i} x={n.t} y={span - (n.p - lo) - 1 + (span - (hi - lo + 1)) / -2 + 0.15} width={Math.max(c.length_ms / 400, n.d)} height={0.7} fill="currentColor" />)}
    </svg>
  )
}

/**
 * The waveform of the part of the audio a clip plays (scaled by its gain), drawn once it has decoded. Only the part
 * in view (plus a margin) is drawn: zoomed in, a whole clip is far wider than browsers allow a canvas (Safari ~16k px).
 */
function ClipWave({ c }: { c: StudioClip }) {
  const box = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  const d = useSyncExternalStore((f) => engine.subscribe(f), () => (c.audio_id ? engine.peek(c.audio_id) : undefined))
  useEffect(() => {
    const el = box.current, cv = ref.current
    if (!el || !cv || !d) return
    const view = el.closest<HTMLElement>('[data-daw-timeline]')
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1
      if (!w || !h) return
      const r = el.getBoundingClientRect(), v = view?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }
      const margin = Math.max(256, v.right - v.left)
      const x0 = Math.max(0, Math.floor(v.left - r.left - margin)), x1 = Math.min(w, Math.ceil(v.right - r.left + margin))
      if (x1 <= x0) { cv.style.display = 'none'; return }
      cv.style.display = ''; cv.style.left = `${x0}px`; cv.style.width = `${x1 - x0}px`
      cv.width = Math.round((x1 - x0) * dpr); cv.height = Math.round(h * dpr)
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, 0)
      g.fillStyle = getComputedStyle(cv).color
      const per = 20, a0 = c.in_ms / per, n = c.length_ms / per
      const scale = d.top > 0 ? (0.9 / d.top) * Math.min(2, c.gain) : 0
      for (let x = x0; x < x1; x++) {
        const a = Math.floor(a0 + (x / w) * n), b = Math.max(a + 1, Math.floor(a0 + ((x + 1) / w) * n))
        let m = 0
        for (let i = a; i < b && i < d.peaks.length; i++) if (d.peaks[i] > m) m = d.peaks[i]
        const bh = Math.max(1, Math.min(1, m * scale) * (h - 12))
        g.fillRect(x, 12 + (h - 12 - bh) / 2, 1, bh)
      }
    }
    let raf = 0
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }
    draw()
    const ro = new ResizeObserver(later); ro.observe(el); if (view) ro.observe(view)
    view?.addEventListener('scroll', later, { passive: true })
    return () => { ro.disconnect(); view?.removeEventListener('scroll', later); cancelAnimationFrame(raf) }
  }, [d, c.in_ms, c.length_ms, c.gain, c.start_ms])
  return (
    <div ref={box} className="pointer-events-none absolute inset-0" data-daw-wave={d ? '1' : '0'}>
      <canvas ref={ref} className="absolute inset-y-0 h-full" />
    </div>
  )
}
