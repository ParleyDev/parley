import { Activity, AudioLines, CircleDot, Download, EyeOff, Headphones, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import type { Attachment } from '../lib/types'
import { formatBytes } from '../lib/upload'
import { loadViz, seek, setSpeed, setVolume, toggle, usePlayer, type Track } from '../lib/player'
import { setPrefs, usePrefs } from '../lib/prefs'
import { fileMenu, saveFile } from '../lib/fileActions'
import { usePhone } from '../lib/swipe'
import { useT } from '../lib/i18n'
import ContextMenu, { useContextMenu } from './ContextMenu'
import AudioVisualizer from './AudioVisualizer'
import Avatar from './Avatar'
import { useStore } from '../store'

export const fmtTime = (sec: number) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}` }
const SPEEDS = [1, 1.25, 1.5, 2, 0.75]
const VIZ = ['bars', 'wave', 'orb', 'off'] as const

/** An audio file's length without downloading it: the browser reads just the header. */
function useDuration(url: string) {
  const [d, setD] = useState(0)
  useEffect(() => {
    const a = new Audio(); a.preload = 'metadata'
    const on = () => { if (Number.isFinite(a.duration)) setD(a.duration) }
    a.addEventListener('loadedmetadata', on); a.src = url
    return () => { a.removeEventListener('loadedmetadata', on); a.removeAttribute('src'); a.load() }
  }, [url])
  return d
}

/** The file's peak waveform from the server's visualiser data (null until it arrives, or when there is none). */
function usePeaks(url: string) {
  const [peaks, setPeaks] = useState<Uint8Array | null>(null)
  useEffect(() => { let live = true; void loadViz(url, true).then((v) => { if (live && v?.peaks.length) setPeaks(v.peaks) }); return () => { live = false } }, [url])
  return peaks
}

/** A seek bar: drag or click anywhere on it, arrow keys step five seconds. With `peaks` the file's waveform sits
 *  behind it as a fixed row of thin bars, the seek line across their middle; played bars take the accent, from a soft
 *  tint at the start to full strength at the playhead, the rest stay a subtle grey. */
export function Scrubber({ pos, duration, onSeek, className = '', peaks }: { pos: number; duration: number; onSeek: (sec: number) => void; className?: string; peaks?: Uint8Array | null }) {
  const t = useT()
  const [drag, setDrag] = useState<number | null>(null)
  const frac = drag ?? (duration ? Math.min(1, pos / duration) : 0)
  const at = (e: RPointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) }
  return (
    <div role="slider" tabIndex={0} aria-label={t('Seek')} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(frac * duration)} aria-valuetext={fmtTime(frac * duration)}
      className={`group relative flex ${peaks ? 'h-10' : 'h-4'} cursor-pointer touch-none items-center ${className}`} data-scrubber data-progress={frac.toFixed(3)} data-wave={peaks ? '1' : undefined}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)) }}
      onPointerMove={(e) => { if (drag != null) setDrag(at(e)) }}
      onPointerUp={(e) => { if (drag != null) { onSeek(at(e) * duration); setDrag(null) } }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, Math.min(duration, frac * duration + (e.key === 'ArrowRight' ? 5 : -5)))) } }}>
      {peaks ? (
        <div className="relative h-full w-full">
          <WaveBars peaks={peaks} frac={frac} />
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-text-2/35" />
          <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${frac * 100}%` }} data-scrubber-fill />
        </div>
      ) : (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-text-2/25">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${frac * 100}%` }} data-scrubber-fill />
        </div>
      )}
      {peaks
        ? <span className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow ring-2 ring-bg-2 transition-transform ${drag != null ? 'scale-125' : 'group-hover:scale-125'}`} style={{ left: `${frac * 100}%` }} data-scrubber-thumb />
        : <span className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-accent transition-opacity ${drag != null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`} style={{ left: `${frac * 100}%` }} />}
    </div>
  )
}

/** Always this many bars, however long the track. */
const WAVE_BARS = 64
/** The peaks as a row of thin bars, centred; `frac` colours the played ones. */
function WaveBars({ peaks, frac }: { peaks: Uint8Array; frac: number }) {
  const bars = Array.from({ length: WAVE_BARS }, (_, i) => {
    const a = Math.floor((i * peaks.length) / WAVE_BARS), z = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / WAVE_BARS))
    let m = 0
    for (let k = a; k < z; k++) m = Math.max(m, peaks[k])
    return m / 255
  })
  return (
    <div className="absolute inset-0 flex items-center justify-between" aria-hidden data-wave-bars>
      {bars.map((v, i) => {
        const at = (i + 0.5) / WAVE_BARS
        const played = at <= frac
        return <span key={i} className={`w-[2px] shrink-0 rounded-full transition-colors duration-200 ${played ? 'bg-accent' : 'bg-text-2'}`}
          style={{ height: `${Math.max(14, v * 100)}%`, opacity: played ? 0.35 + 0.65 * (frac ? at / frac : 1) : 0.28 }} data-played={played ? '1' : undefined} />
      })}
    </div>
  )
}

/**
 * An audio file in chat: a big play button, the title, a live visualisation (bars, wave or orb; the button cycles
 * them, or off), a seek bar, speed and volume. It plays through the app-wide player, so it keeps going when you leave
 * the chat. Download saves it; on phones it opens Save / Share / Copy Link / Open.
 */
export default function AudioPlayer({ a, track: base, mine }: { a: Attachment; track: Track; mine?: boolean }) {
  const t = useT()
  const users = useStore((s) => s.users)
  const openModal = useStore((s) => s.openModal)
  const track: Track = { ...base, count: !mine }
  const phone = usePhone()
  const prefs = usePrefs()
  const p = usePlayer()
  const cur = p.track?.id === a.id
  const playing = cur && p.playing
  const probed = useDuration(a.url)
  const peaks = usePeaks(a.url)
  const duration = (cur && p.duration) || probed
  const pos = cur ? p.pos : 0
  const [speed, setLocalSpeed] = useState(1)
  const menu = useContextMenu()
  const dl = useRef<HTMLButtonElement>(null)
  const ext = (a.filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? a.content_type.split('/')[1] ?? '').toUpperCase()
  const title = a.filename.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ')
  const viz = prefs.audioViz
  const nextViz = VIZ[(VIZ.indexOf(viz) + 1) % VIZ.length]
  const vizIcon = { bars: <AudioLines size={16} />, wave: <Activity size={16} />, orb: <CircleDot size={16} />, off: <EyeOff size={16} /> }[viz]
  const vizLabel = { bars: t('Bars'), wave: t('Wave'), orb: t('Orb'), off: t('Off') }
  const cycleSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setLocalSpeed(next); if (cur) setSpeed(next) }
  const shownSpeed = cur ? p.speed : speed
  const items = fileMenu(a.url, a.filename)
  const openMenu = () => { const r = dl.current?.getBoundingClientRect(); if (r) menu.open({ clientX: r.left, clientY: r.top }, items, { above: true }) }
  const iconBtn = 'h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-text-2 hover:bg-white/10 hover:text-text-0'
  const plays = a.plays ?? 0
  const listeners = a.listened_by ?? []
  const names = listeners.map((u) => users[u]?.display_name ?? t('Someone'))
  const listenersTip = names.length <= 3 ? t('Listened by {names}', { names: names.join(', ') }) : t('Listened by {names} and {n} others', { names: names.slice(0, 2).join(', '), n: names.length - 2 })
  const showListeners = (e: RMouseEvent) => menu.open(e, [
    { node: <div className="px-2 pb-1 pt-0.5 text-xs font-bold uppercase tracking-wide text-text-2">{listeners.length === 1 ? t('1 listener') : t('{n} listeners', { n: listeners.length })}</div> },
    ...listeners.map((u) => ({ label: users[u]?.display_name ?? t('Someone'), icon: users[u] ? <Avatar user={users[u]} size={20} /> : <Headphones size={16} />, onClick: () => openModal({ kind: 'profile', userId: u }) })),
  ])
  const VolIcon = p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2

  return (
    <div className={`relative w-full max-w-[460px] overflow-hidden rounded-xl border bg-bg-2 transition-colors ${playing ? 'border-accent/60' : 'border-line'}`}
      onContextMenu={(e) => menu.open(e, items)} data-audio-player={a.id} data-playing={playing ? '1' : '0'}>
      {/* A soft wash of the accent behind the card while it plays. */}
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/15 via-transparent to-transparent transition-opacity duration-500 ${playing ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
      <div className="relative flex items-center gap-3 px-3 pt-3">
        <button type="button" onClick={() => toggle(track, { speed })} className="relative h-11 w-11 shrink-0 rounded-full bg-accent text-white flex items-center justify-center shadow-lg shadow-accent/25 hover:bg-accent-hover active:scale-95 transition-transform" title={playing ? t('Pause') : t('Play')} aria-label={playing ? t('Pause') : t('Play')} data-audio-play>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
          {playing && <span className="absolute inset-0 rounded-full ring-2 ring-accent/50 animate-ping [animation-duration:2s]" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-text-0" title={a.filename} data-audio-title>{title}</div>
          <div className="flex items-center gap-1.5 text-xs text-text-2">
            {ext && <span className="rounded bg-bg-4 px-1 py-px text-[10px] font-bold tracking-wide text-text-1">{ext}</span>}
            <span>{formatBytes(a.size)}</span>
            {duration > 0 && <><span aria-hidden>·</span><span className="tabular-nums">{fmtTime(duration)}</span></>}
            {plays > 0 && <><span aria-hidden>·</span><span className="flex items-center gap-0.5 tabular-nums" title={plays === 1 ? t('1 play') : t('{n} plays', { n: plays.toLocaleString() })} data-audio-plays={plays}><Play size={10} fill="currentColor" />{plays.toLocaleString()}</span></>}
            {listeners.length > 0 && (
              <button type="button" onClick={showListeners} className="flex items-center gap-0.5 rounded px-0.5 tabular-nums hover:bg-white/10 hover:text-text-0" title={listenersTip} aria-label={listeners.length === 1 ? t('1 listener') : t('{n} listeners', { n: listeners.length })} data-audio-listeners={listeners.length}><Headphones size={11} />{listeners.length.toLocaleString()}</button>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setPrefs({ audioViz: nextViz })} className={iconBtn} title={t('Visualiser: {mode} (click for {next})', { mode: vizLabel[viz], next: vizLabel[nextViz] })} aria-label={t('Visualiser: {mode}', { mode: vizLabel[viz] })} data-audio-viz-mode={viz}>{vizIcon}</button>
        <button ref={dl} type="button" onClick={() => (phone ? openMenu() : void saveFile(a.url, a.filename))} className={iconBtn} title={t('Download')} aria-label={t('Download')} data-audio-download><Download size={17} /></button>
      </div>
      {viz !== 'off' && (
        <button type="button" tabIndex={-1} onClick={() => toggle(track, { speed })} className="relative block w-full px-3 pt-2" aria-hidden data-audio-viz-area>
          <AudioVisualizer mode={viz} active={cur} playing={playing} className="h-14" />
        </button>
      )}
      <div className="relative px-3 pb-2.5 pt-1.5">
        <Scrubber pos={pos} duration={duration} onSeek={(sec) => seek(track, sec)} peaks={peaks} />
        <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums text-text-2">
          <span data-audio-pos>{fmtTime(pos)}</span>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={cycleSpeed} className="rounded-full bg-bg-4 px-1.5 py-0.5 text-[10px] font-bold text-text-1 hover:text-text-0" title={t('Playback speed')} data-audio-speed>{shownSpeed}×</button>
            {!phone && (
              <span className="group/vol flex items-center">
                <button type="button" onClick={() => setVolume(p.volume === 0 ? 1 : 0)} className="h-6 w-6 rounded-full flex items-center justify-center hover:text-text-0" title={p.volume === 0 ? t('Unmute') : t('Mute')} aria-label={p.volume === 0 ? t('Unmute') : t('Mute')} data-audio-mute><VolIcon size={14} /></button>
                <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label={t('Volume')}
                  className="w-0 opacity-0 transition-all duration-200 group-hover/vol:w-16 group-hover/vol:opacity-100 focus:w-16 focus:opacity-100 accent-[var(--color-accent)] h-1" data-audio-volume />
              </span>
            )}
          </span>
          <span data-audio-duration>{duration ? fmtTime(duration) : '–:––'}</span>
        </div>
      </div>
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label={t('File')} />}
    </div>
  )
}
