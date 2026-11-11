import { ChevronDown, Copy, Download, FolderOpen, Magnet, Metronome, Plus, Redo2, Rows3, Scissors, SkipBack, SlidersVertical, Square, Play, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { STORAGE_PREFIX } from '../lib/brand'
import { audible, clipEnd, edit, editLive, engine, exportMix, importFiles, loadProject, newId, projectEnd, redo, sortedLanes, undo, useDaw, type Op } from '../lib/daw'
import { useT } from '../lib/i18n'
import { setArm, setStudioConfig, startTake, DEFAULT_STUDIO } from '../lib/studio'
import { usePhone } from '../lib/swipe'
import type { Channel, StudioClip, StudioLane, StudioProject, StudioTrack } from '../lib/types'
import { voice } from '../lib/voice'
import { useStore, voiceParticipants } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'
import { Fader, Meter } from './StudioConsole'

const VIEW_KEY = `${STORAGE_PREFIX}dawView`
const ZOOM_KEY = `${STORAGE_PREFIX}dawZoom`
const SNAP_KEY = `${STORAGE_PREFIX}dawSnap`
type Snap = 'bar' | 'beat' | 'half' | 'off'
const LANE_H = 76
const COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#00b0f4', '#9b59b6', '#1abc9c']
const laneColor = (l: StudioLane, i: number) => l.color ?? COLORS[i % COLORS.length]

/** 01:02.3 */
const timecode = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(1).padStart(4, '0')}`
const barBeat = (sec: number, bpm: number, beats: number) => { const b = Math.floor((sec * bpm) / 60 + 1e-6); return `${Math.floor(b / beats) + 1}.${(b % beats) + 1}` }
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

/**
 * The studio's DAW, shared live by everyone in the band: an Arrangement of lanes and clips on a timeline (move, trim,
 * split, duplicate, fades, clip gain, snapping to the grid, zoom), a Mixer (a strip per lane and the master), the
 * transport and recording (a take records over the project from the playhead, landing on each member's lane), audio
 * imports (the button, or files dropped on a lane), undo and redo, and export of the mix. Phones get the lite version:
 * play, record, levels and the timeline to look at, without the detailed editing.
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
  const crew = !!me && engineers.includes(me.id)
  const { project, lanes, clips, audio, loading, error, canUndo, canRedo } = useDaw(useShallow((s) => ({ project: s.project, lanes: s.lanes, clips: s.clips, audio: s.audio, loading: s.loading, error: s.error, canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 })))
  const playing = useEngine()
  const [stopped, setStopped] = useState(0)
  const head = usePlayhead(!!playing, stopped)
  const ordered = useMemo(() => sortedLanes(lanes), [lanes])
  const band = participants.filter((p) => !p.suppress)

  const [view, setView] = useState<'arrange' | 'mixer'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'mixer' || (phone && localStorage.getItem(VIEW_KEY) !== 'arrange') ? 'mixer' : 'arrange' } catch { return 'arrange' } })
  const changeView = (v: 'arrange' | 'mixer') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }
  const [pps, setPps] = useState(() => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 40 } catch { return 40 } })
  const zoom = (f: number) => setPps((z) => { const n = Math.min(400, Math.max(4, z * f)); try { localStorage.setItem(ZOOM_KEY, String(n)) } catch { /* ignore */ } return n })
  const [snap, setSnapState] = useState<Snap>(() => { try { return (localStorage.getItem(SNAP_KEY) as Snap) || 'beat' } catch { return 'beat' } })
  const setSnap = (s: Snap) => { setSnapState(s); try { localStorage.setItem(SNAP_KEY, s) } catch { /* ignore */ } }
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { setSel((s) => s.filter((id) => clips[id])) }, [clips])

  const bpm = project?.bpm ?? cfg.bpm, beats = project?.beats ?? cfg.beats
  const beatMs = 60_000 / bpm
  const gridMs = snap === 'bar' ? beatMs * beats : snap === 'beat' ? beatMs : snap === 'half' ? beatMs / 2 : 0
  const snapMs = (ms: number, free = false) => (gridMs && !free ? Math.round(ms / gridMs) * gridMs : ms)

  // Keep the open project loaded (lib/daw also does while we are in the studio's voice).
  useEffect(() => { if (cfg.project_id && project?.id !== cfg.project_id) void loadProject(cfg.project_id) }, [cfg.project_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => {
    if (playing) { setStopped(engine.position()); engine.stop(); return }
    void engine.preload().then(() => engine.play(stopped, { click: cfg.click }))
  }
  const seek = (sec: number) => { const s = Math.max(0, sec); setStopped(s); if (playing === 'local') engine.play(s, { click: cfg.click }) }
  const [busy, setBusy] = useState(false)
  const record = async () => {
    setBusy(true)
    try {
      if (live) await api.post(`/channels/${channel.id}/studio/sessions/${live.id}/stop`)
      else { engine.stop(); await startTake(channel.id, '', stopped * 1000) }
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
    const copies = selected.map((c) => ({ ...c, id: newId(), start_ms: c.start_ms + span }))
    edit(copies.map((c): Op => ({ op: 'clip.put', clip: c })))
    setSel(copies.map((c) => c.id))
  }
  const split = () => {
    const at = head * 1000
    const ops: Op[] = []
    const made: string[] = []
    for (const c of (selected.length ? selected : Object.values(clips))) {
      if (at <= c.start_ms + 5 || at >= clipEnd(c) - 5) continue
      const left = Math.round(at - c.start_ms)
      const id = newId(); made.push(id)
      ops.push({ op: 'clip.put', clip: { id: c.id, length_ms: left, fade_out_ms: 0 } })
      ops.push({ op: 'clip.put', clip: { ...c, id, start_ms: c.start_ms + left, in_ms: c.in_ms + left, length_ms: c.length_ms - left, fade_in_ms: 0 } })
    }
    if (ops.length) { edit(ops); setSel(made) }
  }
  const addLane = () => { const id = newId(); edit([{ op: 'lane.put', lane: { id, name: t('Track {n}', { n: ordered.length + 1 }), position: (ordered[ordered.length - 1]?.position ?? -1) + 1 } }]) }
  const file = useRef<HTMLInputElement>(null)

  // Keys while the DAW has focus (or nothing else does).
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement
      if (a && a !== document.body && !root.current?.contains(a)) return
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(Object.keys(clips)); return }
      if (mod || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); if (!live) play() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); del() } }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); split() }
      else if (e.key === 'Home') { e.preventDefault(); seek(0) }
      else if (e.key === 'Escape') setSel([])
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
  const tb = 'h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div ref={root} tabIndex={-1} className="flex-1 min-h-0 flex flex-col rounded-xl border border-line bg-bg-1 overflow-hidden outline-none" data-daw data-daw-state={state} data-daw-view={view}>
      {/* Control bar: project, tempo, transport, position, undo, view */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-bg-2">
        <ProjectMenu channel={channel} project={project} crew={crew} />
        <div className="flex shrink-0 items-center gap-1">
          <input value={bpmDraft ?? String(bpm)} onChange={(e) => setBpmDraft(e.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={commitBpm} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} inputMode="numeric" title={t('Tempo (BPM)')} aria-label={t('Tempo (BPM)')} className="input h-8 w-14 px-1 text-center font-mono text-sm tabular-nums" data-daw-bpm />
          <Dropdown value={beats} onChange={(e) => void config({ beats: Number(e.target.value) })} title={t('Time signature')} aria-label={t('Time signature')} className="input h-8 w-[4.5rem] px-2 text-sm" data-daw-beats>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
          </Dropdown>
          <button type="button" onClick={() => void config({ click: !cfg.click })} title={cfg.click ? t('Metronome: on') : t('Metronome: off')} aria-pressed={cfg.click} className={`h-8 w-8 rounded-md flex items-center justify-center ${cfg.click ? 'bg-warn text-black' : 'text-text-2 hover:bg-bg-3 hover:text-text-0'}`} data-daw-click><Metronome size={16} /></button>
          <Dropdown value={cfg.count_in} onChange={(e) => void config({ count_in: Number(e.target.value) })} title={t('Count-in')} aria-label={t('Count-in')} className="input h-8 w-24 px-1 text-sm" data-daw-countin>
            <option value={0}>{t('No count-in')}</option>
            {[1, 2, 4].map((n) => <option key={n} value={n}>{n === 1 ? t('1 bar') : t('{n} bars', { n })}</option>)}
          </Dropdown>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => seek(0)} disabled={!!live} title={t('Return to zero (Home)')} className={tb} data-daw-rtz><SkipBack size={18} /></button>
          <button type="button" onClick={play} disabled={!!live} title={playing ? t('Stop (Space)') : t('Play (Space)')} className={`${tb} h-9 w-9 ${playing === 'local' ? 'text-success' : ''}`} aria-pressed={!!playing} data-daw-play>{playing === 'local' ? <Square size={16} /> : <Play size={18} />}</button>
          {crew && <button type="button" onClick={record} disabled={busy} title={live ? t('Stop recording') : t('Record from the playhead')} className={`h-9 w-9 rounded-md flex items-center justify-center disabled:opacity-40 ${live ? 'bg-danger text-white animate-pulse' : 'text-danger hover:bg-bg-3'}`} aria-pressed={!!live} data-daw-record>{live ? <Square size={14} fill="currentColor" /> : <span className="h-4 w-4 rounded-full bg-danger" />}</button>}
        </div>
        <span className={`shrink-0 rounded-md bg-bg-0 px-2.5 py-1 font-mono text-lg tabular-nums ${live ? 'text-danger' : 'text-text-0'}`} data-daw-time>{timecode(head)}</span>
        <span className="shrink-0 rounded-md bg-bg-0 px-2 py-1.5 font-mono text-sm tabular-nums text-text-1" title={t('Bar.beat')} data-daw-beat>{barBeat(head, bpm, beats)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!phone && <>
            <button type="button" onClick={undo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')} className={tb} data-daw-undo><Undo2 size={16} /></button>
            <button type="button" onClick={redo} disabled={!canRedo} title={t('Redo (Ctrl+Shift+Z)')} className={tb} data-daw-redo><Redo2 size={16} /></button>
          </>}
          <span className="flex rounded-md bg-bg-0 p-0.5" role="tablist" aria-label={t('Console view')}>
            <button type="button" role="tab" aria-selected={view === 'arrange'} onClick={() => changeView('arrange')} title={t('Arrangement (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'arrange' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-daw-view-arrange><Rows3 size={16} /></button>
            <button type="button" role="tab" aria-selected={view === 'mixer'} onClick={() => changeView('mixer')} title={t('Mixer (Tab)')} className={`h-8 w-8 rounded flex items-center justify-center ${view === 'mixer' ? 'bg-bg-3 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-daw-view-mixer><SlidersVertical size={16} /></button>
          </span>
          <button type="button" onClick={onClose} title={t('Close console')} className={tb} data-console-close><X size={18} /></button>
        </span>
      </div>
      {/* Edit bar: tracks, import, snap, zoom, the selection, export */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-line bg-bg-2/60 text-xs">
        <button type="button" onClick={addLane} className="btn-ghost h-8 py-1 text-xs" data-daw-add-lane><Plus size={14} /> {t('Track')}</button>
        <button type="button" onClick={() => file.current?.click()} className="btn-ghost h-8 py-1 text-xs" title={t('Import audio files onto new tracks at the playhead')} data-daw-import><Upload size={14} /> {t('Import')}</button>
        <input ref={file} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.opus" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void importFiles(channel.id, fs, head * 1000) }} data-daw-file />
        {!phone && view === 'arrange' && <>
          <span className="mx-1 h-5 w-px bg-line" />
          <Magnet size={14} className={snap === 'off' ? 'text-text-2' : 'text-accent'} aria-hidden />
          <Dropdown value={snap} onChange={(e) => setSnap(e.target.value as Snap)} title={t('Snap to grid (hold Alt to move freely)')} aria-label={t('Snap')} className="input h-8 w-24 px-2 text-xs" data-daw-snap>
            <option value="bar">{t('Bar')}</option><option value="beat">{t('Beat')}</option><option value="half">{t('½ beat')}</option><option value="off">{t('Off')}</option>
          </Dropdown>
          <button type="button" onClick={() => zoom(1 / 1.5)} title={t('Zoom out')} className={tb} data-daw-zoom-out><ZoomOut size={16} /></button>
          <button type="button" onClick={() => zoom(1.5)} title={t('Zoom in')} className={tb} data-daw-zoom-in><ZoomIn size={16} /></button>
        </>}
        {!phone && selected.length > 0 && <>
          <span className="mx-1 h-5 w-px bg-line" />
          <button type="button" onClick={split} title={t('Split at the playhead (S)')} className={tb} data-daw-split><Scissors size={15} /></button>
          <button type="button" onClick={duplicate} title={t('Duplicate (Ctrl+D)')} className={tb} data-daw-duplicate><Copy size={15} /></button>
          <button type="button" onClick={del} title={t('Delete (Del)')} className={`${tb} hover:text-danger`} data-daw-delete><Trash2 size={15} /></button>
          {selected.length === 1 && <ClipInspector clip={selected[0]} />}
        </>}
        <button type="button" onClick={() => void exportMix().catch((e) => pushToast((e as Error).message, 'error'))} disabled={!Object.keys(clips).length} className="btn-ghost ml-auto h-8 py-1 text-xs whitespace-nowrap disabled:opacity-40" title={t('Render the project to one WAV')} data-daw-export><Download size={14} /> {t('Export mix')}</button>
      </div>

      {view === 'arrange'
        ? <Arrangement {...{ channel, ordered, lanes, clips, audio, pps, head, live: !!live, liveSince: live ? (live.position_ms ?? 0) / 1000 : 0, sel, setSel, seek, snapMs, beatMs, beats, band: band.map((b) => b.user_id), crew, users, phone }} />
        : <Mixer ordered={ordered} lanes={lanes} project={project} band={band.map((b) => b.user_id)} disarmed={cfg.disarmed} crew={crew} channelId={channel.id} users={users} />}
      {ordered.length === 0 && <p className="shrink-0 px-3 py-2 text-xs text-text-2" data-daw-empty>{crew ? t('Press Record to lay down the first take, or import a backing track to record over.') : t('Import a backing track, or ask an engineer to record a take.')}</p>}
    </div>
  )
}

/** The project name, with switching, new, rename and delete. */
function ProjectMenu({ channel, project, crew }: { channel: Channel; project: StudioProject; crew: boolean }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const me = useStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<StudioProject[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const load = () => void api.get<StudioProject[]>(`/channels/${channel.id}/studio/projects`).then(setList).catch(() => {})
    load()
    const on = (e: Event) => { if ((e as CustomEvent).detail === channel.id) load() }
    window.addEventListener('parley-studio-projects', on)
    return () => window.removeEventListener('parley-studio-projects', on)
  }, [open, channel.id])
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  const openProject = (id: string | null) => { setOpen(false); api.put(`/channels/${channel.id}/studio/project`, { project_id: id }).catch(fail) }
  const create = () => { setOpen(false); api.post(`/channels/${channel.id}/studio/projects`, { name: '' }).catch(fail) }
  const remove = () => { setOpen(false); openModal({ kind: 'confirm', title: t('Delete {name}', { name: project.name }), body: t('Deletes the project: its tracks, clips and mix. Recorded takes stay in Sessions. This cannot be undone.'), danger: true, confirmLabel: t('Delete'), action: async () => { try { await api.delete(`/studio/projects/${project.id}`) } catch (e) { fail(e) } } }) }
  if (renaming !== null) return <input autoFocus value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} onBlur={() => { if (renaming.trim() && renaming !== project.name) edit([{ op: 'project', name: renaming.trim() }]); setRenaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} className="input h-8 w-44 text-sm font-semibold" aria-label={t('Project name')} data-daw-project-name-input />
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} onDoubleClick={() => setRenaming(project.name)} className="flex h-8 max-w-48 items-center gap-1.5 rounded-md bg-bg-0 px-2.5 text-sm font-semibold hover:bg-bg-3" title={t('Projects (double-click to rename)')} aria-expanded={open} data-daw-project={project.id}>
        <FolderOpen size={15} className="shrink-0 text-accent" /><span className="truncate" data-daw-project-name>{project.name}</span><ChevronDown size={14} className="shrink-0 text-text-2" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 w-64 rounded-lg border border-line bg-bg-1 p-1 shadow-xl" role="menu" data-daw-projects>
            {(list ?? []).map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === project.id} onClick={() => openProject(p.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-3 ${p.id === project.id ? 'font-semibold text-accent' : ''}`} data-daw-project-item={p.id}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span><span className="shrink-0 font-mono text-[10px] text-text-2">{p.bpm} BPM</span>
              </button>
            ))}
            {list === null && <p className="px-2 py-1.5 text-xs text-text-2">…</p>}
            <div className="my-1 h-px bg-line" />
            <button type="button" onClick={create} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-3" data-daw-new-project><Plus size={14} /> {t('New project')}</button>
            <button type="button" onClick={() => { setOpen(false); setRenaming(project.name) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-3" data-daw-rename>{t('Rename…')}</button>
            <button type="button" onClick={() => openProject(null)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-3" data-daw-close-project>{t('Close project (takes only)')}</button>
            {(crew || project.created_by === me?.id) && <button type="button" onClick={remove} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-danger hover:bg-danger/10" data-daw-delete-project><Trash2 size={14} /> {t('Delete project')}</button>}
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
      <label className="flex items-center gap-1 text-text-2" title={t('Fade in (ms)')}>{t('In')}<input type="number" min={0} step={50} value={clip.fade_in_ms} onChange={(e) => editLive(`fi:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, fade_in_ms: Math.max(0, Math.min(clip.length_ms, Number(e.target.value) || 0)) } }])} className={num} data-daw-fade-in /></label>
      <label className="flex items-center gap-1 text-text-2" title={t('Fade out (ms)')}>{t('Out')}<input type="number" min={0} step={50} value={clip.fade_out_ms} onChange={(e) => editLive(`fo:${clip.id}`, [{ op: 'clip.put', clip: { id: clip.id, fade_out_ms: Math.max(0, Math.min(clip.length_ms, Number(e.target.value) || 0)) } }])} className={num} data-daw-fade-out /></label>
      <button type="button" onClick={() => edit([{ op: 'clip.put', clip: { id: clip.id, muted: !clip.muted } }])} aria-pressed={clip.muted} className={`h-7 rounded px-2 text-[11px] font-bold ${clip.muted ? 'bg-danger text-white' : 'bg-bg-3 text-text-2 hover:text-text-0'}`} data-daw-clip-mute>{t('Mute clip')}</button>
    </span>
  )
}

type ArrProps = {
  channel: Channel; ordered: StudioLane[]; lanes: Record<string, StudioLane>; clips: Record<string, StudioClip>; audio: Record<string, StudioTrack>
  pps: number; head: number; live: boolean; liveSince: number; sel: string[]; setSel: (s: string[] | ((s: string[]) => string[])) => void
  seek: (sec: number) => void; snapMs: (ms: number, free?: boolean) => number; beatMs: number; beats: number; band: string[]; crew: boolean
  users: Record<string, import('../lib/types').User>; phone: boolean
}

function Arrangement(p: ArrProps) {
  const t = useT()
  const { ordered, lanes, clips, pps, head, sel, setSel, snapMs, beatMs, beats, phone } = p
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropLane, setDropLane] = useState<string | 'new' | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const total = Math.max(120, projectEnd(clips) / 1000 + 30, head + 30)
  const width = Math.ceil(total * pps)
  const barMs = beatMs * beats
  // Ruler: a label every n bars so they don't crowd.
  const every = [1, 2, 4, 8, 16, 32].find((n) => (n * barMs / 1000) * pps >= 48) ?? 64
  const bars: number[] = []
  for (let b = 0; b * barMs / 1000 < total; b++) bars.push(b)
  const msAt = (clientX: number) => { const r = scroller.current!.getBoundingClientRect(); return Math.max(0, ((clientX - r.left + scroller.current!.scrollLeft) / pps) * 1000) }
  const laneAt = (clientY: number) => (document.elementsFromPoint(scroller.current!.getBoundingClientRect().left + 4, clientY).find((e) => (e as HTMLElement).dataset?.dawLane) as HTMLElement | undefined)?.dataset.dawLane ?? null

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
    if (drag.mode === 'move') return { ...c, start_ms: Math.max(0, Math.round(c.start_ms + d)), lane_id: drag.ids.length === 1 && drag.lane ? drag.lane : c.lane_id }
    const len = p.audio[c.audio_id]?.duration_ms ?? Infinity
    if (drag.mode === 'trimL') { const dd = Math.max(-c.in_ms, -c.start_ms, Math.min(c.length_ms - 20, d)); return { ...c, start_ms: Math.round(c.start_ms + dd), in_ms: Math.round(c.in_ms + dd), length_ms: Math.round(c.length_ms - dd), fade_in_ms: Math.min(c.fade_in_ms, c.length_ms - dd) } }
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
    if (d.copy) { const made = out.map((c) => ({ ...c, id: newId() })); edit(made.map((c): Op => ({ op: 'clip.put', clip: c }))); setSel(made.map((c) => c.id)); return }
    edit(out.map((c): Op => ({ op: 'clip.put', clip: { id: c.id, lane_id: c.lane_id, start_ms: c.start_ms, in_ms: c.in_ms, length_ms: c.length_ms, fade_in_ms: c.fade_in_ms, fade_out_ms: c.fade_out_ms } })))
  }

  const onDrop = (e: React.DragEvent, lane: string | null) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac|webm|opus)$/i.test(f.name))
    setDropLane(null)
    if (!files.length) return
    e.preventDefault()
    void importFiles(p.channel.id, files, snapMs(msAt(e.clientX)), lane ?? undefined)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-daw-arrangement>
      <div className="flex min-h-full">
        <div className="w-56 phone:w-32 shrink-0 border-r border-line bg-bg-2/60">
          <div className="sticky top-0 z-10 h-7 border-b border-line bg-bg-2" />
          {ordered.map((l, i) => <LaneHead key={l.id} l={l} i={i} {...p} />)}
          {/* Recording members without a lane yet: theirs is made when the take lands. */}
          {p.live && p.band.filter((u) => !ordered.some((l) => l.user_id === u)).map((u) => (
            <div key={u} className="flex items-center gap-1.5 border-b border-line/60 pl-3 pr-2 text-sm opacity-80" style={{ height: LANE_H }} data-daw-lane-pending={u}>
              {p.users[u] && <Avatar user={p.users[u]} size={18} />}
              <span className="min-w-0 truncate font-semibold">{p.users[u]?.display_name ?? p.users[u]?.username ?? ''}</span>
              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase text-danger">{t('Rec')}</span>
            </div>
          ))}
        </div>
        <div ref={scroller} className="relative flex-1 min-w-0 overflow-x-auto" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropLane(laneAt(e.clientY) ?? 'new') } }} onDragLeave={() => setDropLane(null)} onDrop={(e) => onDrop(e, laneAt(e.clientY))} data-daw-timeline>
          <div className="relative" style={{ width }}>
            <div className="sticky top-0 z-10 h-7 cursor-pointer border-b border-line bg-bg-2 text-[10px] text-text-2 select-none" onPointerDown={(e) => p.seek(snapMs(msAt(e.clientX), e.altKey) / 1000)} data-daw-ruler>
              {bars.filter((b) => b % every === 0).map((b) => <span key={b} className="absolute top-0 h-full border-l border-line pl-1 leading-7" style={{ left: (b * barMs / 1000) * pps }}>{b + 1}</span>)}
            </div>
            <div className="relative" onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.dawLane) { setSel([]); p.seek(snapMs(msAt(e.clientX), e.altKey) / 1000) } }}>
              {bars.map((b) => <div key={b} className={`pointer-events-none absolute top-0 bottom-0 w-px ${b % every === 0 ? 'bg-line/70' : 'bg-line/25'}`} style={{ left: (b * barMs / 1000) * pps }} />)}
              {ordered.map((l, i) => (
                <div key={l.id} className={`relative border-b border-line/60 ${dropLane === l.id ? 'bg-accent/10' : ''}`} style={{ height: LANE_H }} data-daw-lane={l.id}>
                  {Object.values(clips).filter((c) => dragged(c).lane_id === l.id).map((c) => <Region key={c.id} c={dragged(c)} color={laneColor(l, i)} pps={pps} selected={sel.includes(c.id)} dim={!audible(lanes, l.id) || c.muted} name={p.audio[c.audio_id]?.name ?? p.audio[c.audio_id]?.display_name ?? ''} begin={begin} move={moveDrag} end={endDrag} phone={phone} onSelect={(e) => { if (phone) setSel([c.id]); else if (!drag) setSel(e.shiftKey ? (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id]) }} />)}
                  {p.live && l.user_id && p.band.includes(l.user_id) && head > p.liveSince && <div className="pointer-events-none absolute inset-y-2 rounded-md border border-danger bg-danger/20" style={{ left: p.liveSince * pps, width: (head - p.liveSince) * pps }} data-daw-recording={l.id} />}
                </div>
              ))}
              {p.live && p.band.filter((u) => !ordered.some((l) => l.user_id === u)).map((u) => (
                <div key={u} className="relative border-b border-line/60 opacity-80" style={{ height: LANE_H }}>
                  {head > p.liveSince && <div className="pointer-events-none absolute inset-y-2 rounded-md border border-danger bg-danger/20" style={{ left: p.liveSince * pps, width: (head - p.liveSince) * pps }} />}
                </div>
              ))}
              <div className={`h-16 ${dropLane === 'new' ? 'bg-accent/10' : ''}`} data-daw-lane-new>{dropLane === 'new' && <span className="block pt-5 text-center text-xs text-accent">{t('Drop to import onto a new track')}</span>}</div>
              <div className={`pointer-events-none absolute -top-7 bottom-0 z-20 w-px ${p.live ? 'bg-danger' : 'bg-text-0'}`} style={{ left: head * pps }} data-daw-playhead />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LaneHead({ l, i, lanes, clips, band, crew, channel, users, phone }: ArrProps & { l: StudioLane; i: number }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [naming, setNaming] = useState<string | null>(null)
  const owner = l.user_id ? users[l.user_id] : undefined
  const inBand = !!l.user_id && band.includes(l.user_id)
  const armed = inBand && !(channel.studio?.disarmed ?? []).includes(l.user_id!)
  const has = Object.values(clips).some((c) => c.lane_id === l.id)
  const btn = (on: boolean, cls: string) => `h-5 w-5 rounded text-[10px] font-bold ${on ? cls : 'bg-bg-3 text-text-2 hover:text-text-0'}`
  return (
    <div className={`group relative flex flex-col justify-center gap-1 border-b border-line/60 pl-3 pr-2 ${audible(lanes, l.id) ? '' : 'opacity-60'}`} style={{ height: LANE_H }} data-daw-lane-head={l.id}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: laneColor(l, i) }} aria-hidden />
      <div className="flex min-w-0 items-center gap-1.5">
        {owner && <Avatar user={owner} size={18} />}
        {naming !== null
          ? <input autoFocus value={naming} maxLength={80} onChange={(e) => setNaming(e.target.value)} onBlur={() => { if (naming.trim() && naming !== l.name) edit([{ op: 'lane.put', lane: { id: l.id, name: naming.trim() } }]); setNaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNaming(null) }} className="input h-6 min-w-0 flex-1 px-1 text-sm" aria-label={t('Track name')} data-daw-lane-name-input />
          : <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={t('{name} (double-click to rename)', { name: l.name })} onDoubleClick={() => setNaming(l.name)} data-daw-lane-name>{l.name}</span>}
        {!phone && <button type="button" onClick={() => edit([{ op: 'lane.del', id: l.id }])} title={has ? t('Delete track and its clips') : t('Delete track')} className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-2 hover:text-danger group-hover:flex" data-daw-lane-delete><Trash2 size={12} /></button>}
      </div>
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, mute: !l.mute } }])} title={t('Mute')} aria-pressed={l.mute} className={btn(l.mute, 'bg-danger text-white')} data-daw-mute={l.id}>M</button>
        <button type="button" onClick={() => edit([{ op: 'lane.put', lane: { id: l.id, solo: !l.solo } }])} title={t('Solo')} aria-pressed={l.solo} className={btn(l.solo, 'bg-warn text-black')} data-daw-solo={l.id}>S</button>
        {inBand && <button type="button" disabled={!crew} onClick={() => setArm(channel.id, l.user_id!, !armed).catch((e) => pushToast((e as Error).message, 'error'))} title={armed ? t('Armed: records the next take') : t('Not armed')} aria-pressed={armed} className={btn(armed, 'bg-danger text-white')} data-daw-arm={l.id}>R</button>}
        <input type="range" min={0} max={150} value={Math.round(l.gain * 100)} onChange={(e) => editLive(`gain:${l.id}`, [{ op: 'lane.put', lane: { id: l.id, gain: Number(e.target.value) / 100 } }])} onDoubleClick={() => edit([{ op: 'lane.put', lane: { id: l.id, gain: 1 } }])} title={t('Volume {db} dB', { db: dB(l.gain) })} aria-label={t('Volume')} className="ml-1 h-3 min-w-0 flex-1 accent-accent" data-daw-lane-gain={l.id} />
      </div>
      <Meter get={() => engine.level(l.id) || (l.user_id && inBand ? voice.level(l.user_id) : 0)} id={l.id} />
    </div>
  )
}

/** A clip: its waveform (the part of the audio it plays), fades, and handles to trim and fade. */
function Region({ c, color, pps, selected, dim, name, begin, move, end, onSelect, phone }: { c: StudioClip; color: string; pps: number; selected: boolean; dim: boolean; name: string; begin: (e: RPointerEvent, c: StudioClip, mode: Drag['mode']) => void; move: (e: RPointerEvent) => void; end: () => void; onSelect: (e: React.MouseEvent) => void; phone: boolean }) {
  const w = Math.max(2, (c.length_ms / 1000) * pps)
  const fi = (c.fade_in_ms / 1000) * pps, fo = (c.fade_out_ms / 1000) * pps
  const h = LANE_H - 12
  return (
    <div className={`absolute top-1.5 overflow-hidden rounded-md border ${selected ? 'ring-2 ring-white/80' : ''} ${dim ? 'opacity-45' : ''} ${phone ? '' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ left: (c.start_ms / 1000) * pps, width: w, height: h, borderColor: color, background: `${color}33`, color }}
      onPointerDown={(e) => begin(e, c, 'move')} onPointerMove={move} onPointerUp={end} onClick={onSelect} data-daw-clip={c.id} data-selected={selected ? '1' : undefined}>
      <ClipWave c={c} />
      <span className="pointer-events-none absolute left-1.5 top-0.5 max-w-[calc(100%-12px)] truncate text-[10px] font-semibold text-text-0/90">{name}{c.gain !== 1 ? ` · ${dB(c.gain)} dB` : ''}</span>
      <svg className="pointer-events-none absolute inset-0" width={w} height={h} aria-hidden>
        {fi > 0 && <path d={`M0 ${h} L${fi} 0 L0 0 Z`} fill="rgba(0,0,0,.35)" />}
        {fo > 0 && <path d={`M${w} ${h} L${w - fo} 0 L${w} 0 Z`} fill="rgba(0,0,0,.35)" />}
      </svg>
      {!phone && <>
        <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => begin(e, c, 'trimL')} onPointerMove={move} onPointerUp={end} data-daw-trim-left />
        <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => begin(e, c, 'trimR')} onPointerMove={move} onPointerUp={end} data-daw-trim-right />
        <span className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 cursor-pointer rounded-full border border-white bg-black/60" style={{ left: Math.max(5, fi) }} onPointerDown={(e) => begin(e, c, 'fadeIn')} onPointerMove={move} onPointerUp={end} title="Fade in" data-daw-fade-in-handle />
        <span className="absolute top-0 h-2.5 w-2.5 translate-x-1/2 cursor-pointer rounded-full border border-white bg-black/60" style={{ right: Math.max(5, fo) }} onPointerDown={(e) => begin(e, c, 'fadeOut')} onPointerMove={move} onPointerUp={end} title="Fade out" data-daw-fade-out-handle />
      </>}
    </div>
  )
}

/** The waveform of the part of the audio a clip plays (scaled by its gain), drawn once it has decoded. */
function ClipWave({ c }: { c: StudioClip }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const d = useSyncExternalStore((f) => engine.subscribe(f), () => engine.peek(c.audio_id))
  useEffect(() => {
    const cv = ref.current
    if (!cv || !d) return
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1
      if (!w || !h) return
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = getComputedStyle(cv).color
      const per = 20, a0 = c.in_ms / per, n = c.length_ms / per
      const scale = d.top > 0 ? (0.9 / d.top) * Math.min(2, c.gain) : 0
      for (let x = 0; x < w; x++) {
        const a = Math.floor(a0 + (x / w) * n), b = Math.max(a + 1, Math.floor(a0 + ((x + 1) / w) * n))
        let m = 0
        for (let i = a; i < b && i < d.peaks.length; i++) if (d.peaks[i] > m) m = d.peaks[i]
        const bh = Math.max(1, Math.min(1, m * scale) * (h - 12))
        g.fillRect(x, 12 + (h - 12 - bh) / 2, 1, bh)
      }
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(cv)
    return () => ro.disconnect()
  }, [d, c.in_ms, c.length_ms, c.gain])
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" data-daw-wave={d ? '1' : '0'} />
}

/** A strip per lane (pan, mute / solo / arm, fader with meter) and the master. */
function Mixer({ ordered, lanes, project, band, disarmed, crew, channelId, users }: { ordered: StudioLane[]; lanes: Record<string, StudioLane>; project: StudioProject; band: string[]; disarmed: string[]; crew: boolean; channelId: string; users: Record<string, import('../lib/types').User> }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const panLabel = (p: number) => (Math.abs(p) < 0.01 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 50)}`)
  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" data-daw-mixer>
      <div className="flex h-full min-h-[18rem] gap-1.5 p-2">
        {ordered.map((l, i) => {
          const inBand = !!l.user_id && band.includes(l.user_id)
          const armed = inBand && !disarmed.includes(l.user_id!)
          const btn = (on: boolean, cls: string) => `h-6 w-full rounded text-[11px] font-bold disabled:opacity-30 ${on ? cls : 'bg-bg-3 text-text-2 hover:text-text-0'}`
          return (
            <div key={l.id} className={`flex w-24 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-line bg-bg-2 p-1.5 ${audible(lanes, l.id) ? '' : 'opacity-60'}`} style={{ borderTopColor: laneColor(l, i), borderTopWidth: 3 }} data-daw-strip={l.id}>
              <div className="flex min-w-0 items-center gap-1">
                {l.user_id && users[l.user_id] && <Avatar user={users[l.user_id]} size={16} />}
                <span className="truncate text-xs font-semibold" title={l.name}>{l.name}</span>
              </div>
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
        <div className="ml-auto flex w-24 shrink-0 flex-col items-stretch gap-1.5 rounded-lg border border-accent/50 bg-bg-2 p-1.5" data-daw-strip="master">
          <span className="text-xs font-bold uppercase tracking-wide text-text-1">{t('Master')}</span>
          <Fader value={project.master_gain} onChange={(v) => editLive('master', [{ op: 'project', master_gain: v }])} get={() => engine.level('master')} id="master" label={t('Master')} />
        </div>
      </div>
    </div>
  )
}
