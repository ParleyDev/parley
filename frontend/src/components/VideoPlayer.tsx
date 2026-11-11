import { Download, ExternalLink, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { fmtTime } from './AudioPlayer'
import { absoluteUrl } from '../lib/imageMenu'
import { fileMenu, saveFile } from '../lib/fileActions'
import { pause as pauseAudio, usePlayer } from '../lib/player'
import { STORAGE_PREFIX } from '../lib/brand'
import { usePhone } from '../lib/swipe'
import { useT } from '../lib/i18n'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const VOLUME = `${STORAGE_PREFIX}videoVolume`
/** Controls fade out after this long without the pointer moving, while playing. */
const IDLE_MS = 2500

/** Volume and mute are remembered across videos (and launches), as Discord does. */
const readVolume = (): { v: number; muted: boolean } => { try { const o = JSON.parse(localStorage.getItem(VOLUME) ?? ''); return { v: Math.max(0, Math.min(1, Number(o.v ?? 1))), muted: !!o.muted } } catch { return { v: 1, muted: false } } }
const writeVolume = (v: number, muted: boolean) => { try { localStorage.setItem(VOLUME, JSON.stringify({ v, muted })) } catch { /* ignore */ } }

/** One video plays at a time: starting another pauses this one. */
let current: HTMLVideoElement | null = null

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void }
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean }
const fsElement = () => document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null
type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void> }

/**
 * A video in chat that plays where it is, like Discord's: a poster with a play button and its length until started,
 * then the video with its own controls (play, a seek bar showing what has loaded, time, volume, speed, full screen)
 * that fade while it plays and come back on a mouse move or a tap. Click plays/pauses (a tap on a phone shows the
 * controls), double-click and F go full screen with the same controls; iPhones, which can't put a page element full
 * screen, hand the video to the system player. Space/K, the arrows, M and F work while it has focus.
 *
 * `w`/`h` are the video's size when known (the server's poster frame), so the box has its shape before loading; the
 * box fits within `maxW` x `maxH`, or fills its parent's width without `maxW`.
 */
export default function VideoPlayer({ src, poster, name, w: knownW, h: knownH, maxW, maxH, actions = true, id }: {
  src: string; poster?: string; name: string; w?: number | null; h?: number | null; maxW?: number; maxH?: number; actions?: boolean; id?: string
}) {
  const t = useT()
  const phone = usePhone()
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<IosVideo>(null)
  const menu = useContextMenu()
  const dl = useRef<HTMLButtonElement>(null)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [vol, setVol] = useState(readVolume)
  const [speed, setSpeed] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [fs, setFs] = useState(false)
  const [shown, setShown] = useState(true)
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const idle = useRef<number | undefined>(undefined)
  const touch = useRef(false)
  const audio = usePlayer()

  // The app-wide audio player starting pauses the video, and the other way round (see play()).
  useEffect(() => { if (audio.playing) video.current?.pause() }, [audio.playing])

  const v = () => video.current!
  const play = useCallback(() => {
    const el = video.current
    if (!el) return
    if (current && current !== el) current.pause()
    current = el
    pauseAudio()
    setStarted(true)
    if (el.ended) el.currentTime = 0
    el.play().catch(() => { /* refused (no gesture); the play button stays */ })
  }, [])
  const toggle = () => { if (!started || v().paused) play(); else v().pause() }

  /** Show the controls, and hide them again after a while if it's playing. */
  const wake = useCallback(() => {
    setShown(true)
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => { if (video.current && !video.current.paused) setShown(false) }, IDLE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(idle.current), [])
  useEffect(() => { if (playing) wake(); else setShown(true) }, [playing, wake])

  // The playhead moves every frame while playing, not only on the browser's few timeupdates a second.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => { const el = video.current; if (el) setPos(el.currentTime); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  useEffect(() => { const el = video.current; if (el) { el.volume = vol.v; el.muted = vol.muted } }, [vol])
  useEffect(() => { if (video.current) video.current.playbackRate = speed }, [speed])

  useEffect(() => {
    const on = () => {
      const now = !!box.current && fsElement() === box.current
      setFs(now)
      const o = screen.orientation as Lockable | undefined
      if (!now) { try { o?.unlock() } catch { /* ignore */ } }
    }
    document.addEventListener('fullscreenchange', on); document.addEventListener('webkitfullscreenchange', on)
    return () => { document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on) }
  }, [])
  const fullscreen = () => {
    const el = box.current as FsEl | null, vid = video.current
    if (!el || !vid) return
    if (fsElement()) { const d = document as FsDoc; if (d.exitFullscreen) d.exitFullscreen().catch(() => {}); else d.webkitExitFullscreen?.(); return }
    // A wide video on a phone turns the screen sideways, as native players do.
    const landscape = () => { if (phone && vid.videoWidth > vid.videoHeight) (screen.orientation as Lockable | undefined)?.lock?.('landscape').catch(() => {}) }
    const native = () => { if (!started) play(); vid.webkitEnterFullscreen?.() }
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(landscape).catch(native)
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    else native()
  }

  const setVolume = (next: number, muted = next === 0) => { const o = { v: next, muted }; setVol(o); writeVolume(o.v, o.muted) }
  const toggleMute = () => setVolume(vol.muted && vol.v === 0 ? 0.5 : vol.v, !vol.muted)
  const seekTo = (sec: number) => { const el = video.current; if (!el || !dur) return; el.currentTime = Math.max(0, Math.min(dur, sec)); setPos(el.currentTime); if (!started) setStarted(true) }

  const onKey = (e: RKeyboardEvent) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[role="slider"], button') && (e.key === ' ' || e.key === 'Enter')) return
    const k = e.key.toLowerCase()
    const step = (d: number) => seekTo(v().currentTime + d)
    const handled = ({
      ' ': toggle, k: toggle, f: fullscreen, m: toggleMute,
      arrowleft: () => step(-5), arrowright: () => step(5), j: () => step(-10), l: () => step(10),
      arrowup: () => setVolume(Math.min(1, vol.v + 0.1), false), arrowdown: () => setVolume(Math.max(0, vol.v - 0.1)),
    } as Record<string, () => void>)[k]
    if (!handled || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault(); e.stopPropagation(); handled(); wake()
  }

  // Box size: the known (or loaded) shape, fitted to the limits.
  const w = dims?.w || knownW || 16, h = dims?.h || knownH || 9
  const scale = maxW && maxH ? Math.min(maxW / w, maxH / h) : 0
  const style = fs ? undefined : { width: scale ? Math.round(w * scale) : '100%', aspectRatio: `${w} / ${h}` }

  const items = fileMenu(src, name)
  const frac = drag ?? (dur ? Math.min(1, pos / dur) : 0)
  const at = (e: RPointerEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) }
  const visible = !started || !playing || shown || drag != null || speedOpen || !!menu.menu
  const VolIcon = vol.muted || vol.v === 0 ? VolumeX : vol.v < 0.5 ? Volume1 : Volume2
  const btn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/90 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white'

  return (
    <div ref={box} tabIndex={0} role="group" aria-label={name} onKeyDown={onKey}
      className={`group/vp relative max-w-full select-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-accent ${fs ? 'flex h-full w-full items-center justify-center' : 'rounded-lg border border-line'} ${started && !visible ? 'cursor-none' : ''}`}
      style={style} onPointerMove={(e) => { if (e.pointerType === 'mouse') wake() }} onPointerLeave={(e) => { if (e.pointerType === 'mouse' && playing && drag == null) setShown(false) }}
      onContextMenu={(e) => menu.open(e, items)} data-inline-video={id} data-video-player={started ? (playing ? 'playing' : ended ? 'ended' : 'paused') : 'poster'} data-fullscreen={fs ? '1' : undefined}>
      {/* The server's poster frame: the phone apps' web views don't paint a frame until the video plays. Without one,
          #t has Safari show the first frame instead of black. */}
      <video ref={video} src={poster || started ? src : `${src}#t=0.1`} poster={poster} preload="metadata" playsInline
        className="h-full w-full object-contain" data-inline-video-poster={poster ? 'server' : 'frame'}
        onLoadedMetadata={(e) => { const el = e.currentTarget; if (el.videoWidth) setDims({ w: el.videoWidth, h: el.videoHeight }); if (Number.isFinite(el.duration)) setDur(el.duration); el.volume = vol.v; el.muted = vol.muted }}
        onDurationChange={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration) }}
        onPlay={() => { setPlaying(true); setEnded(false); setStarted(true); pauseAudio() }} onPause={() => setPlaying(false)}
        onEnded={(e) => { setPlaying(false); setEnded(true); setPos(e.currentTarget.currentTime) }} onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => { if (!playing) setPos(e.currentTarget.currentTime) }}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuffered(b.end(b.length - 1)) }}
        onVolumeChange={(e) => { const el = e.currentTarget; if (el.muted !== vol.muted || Math.abs(el.volume - vol.v) > 0.001) setVolume(el.volume, el.muted) }} />

      {/* The surface: click plays/pauses (a tap shows or hides the controls), double-click goes full screen. */}
      <div className="absolute inset-0" onPointerDown={(e) => { touch.current = e.pointerType !== 'mouse' }}
        onClick={() => { if (!started) { play(); return } if (touch.current) { if (visible && playing) setShown(false); else wake() } else { toggle(); wake() } }}
        onDoubleClick={() => { if (!touch.current) fullscreen() }} data-video-surface />

      {!started && (
        <>
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" aria-hidden />
          <button type="button" onClick={play} aria-label={t('Play {name}', { name })} title={t('Play')}
            className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform hover:scale-110 hover:bg-accent" data-video-play>
            <Play size={26} fill="currentColor" className="ml-1" />
          </button>
          {dur > 0 && <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white" data-inline-video-duration>{fmtTime(dur)}</span>}
        </>
      )}

      {started && waiting && playing && <Loader2 size={40} className="pointer-events-none absolute left-1/2 top-1/2 -ml-5 -mt-5 animate-spin text-white/90" aria-hidden data-video-loading />}
      {started && ended && (
        <button type="button" onClick={play} aria-label={t('Replay')} title={t('Replay')} className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-accent" data-video-replay>
          <RotateCcw size={26} />
        </button>
      )}
      {/* Touch: a big play/pause in the middle with the controls, as phone players have. */}
      {started && !ended && touch.current && visible && !waiting && (
        <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); wake() }} aria-label={playing ? t('Pause') : t('Play')}
          className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white" data-video-center>
          {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
        </button>
      )}

      {/* Download and open, top right, on hover (always shown on phones before playing). */}
      {actions && (
        <div className={`absolute right-2 top-2 flex gap-1 transition-opacity ${started ? (visible ? 'opacity-100' : 'pointer-events-none opacity-0') : phone ? 'opacity-100' : 'opacity-0 group-hover/vp:opacity-100 group-focus-within/vp:opacity-100'}`}>
          <button ref={dl} type="button" onClick={(e) => { e.stopPropagation(); const r = dl.current?.getBoundingClientRect(); if (phone && r) menu.open({ clientX: r.left, clientY: r.bottom }, items); else void saveFile(src, name) }}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-black/60 text-white/90 hover:bg-black/80 hover:text-white" title={t('Download')} aria-label={t('Download')} data-video-download><Download size={16} /></button>
          {!phone && <a href={absoluteUrl(src)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex h-8 w-8 items-center justify-center rounded-md bg-black/60 text-white/90 hover:bg-black/80 hover:text-white" title={t('Open original')} aria-label={t('Open original')}><ExternalLink size={15} /></a>}
        </div>
      )}

      {started && (
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent pointer-events-none px-2 pb-1 pt-8 transition-opacity duration-200 ${visible ? 'opacity-100 [&>*]:pointer-events-auto' : 'opacity-0'} ${fs ? 'pb-[max(4px,env(safe-area-inset-bottom))]' : ''}`}
          onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} data-video-controls>
          {/* Only the bar and the buttons take clicks: the gradient lets them through to the video. */}
          {/* Seek bar: what has loaded, what has played, the time under the pointer. */}
          <div role="slider" tabIndex={0} aria-label={t('Seek')} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(frac * dur)} aria-valuetext={fmtTime(frac * dur)}
            className="group/seek relative flex h-5 cursor-pointer touch-none items-center" data-video-seek data-progress={frac.toFixed(3)}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)) }}
            onPointerMove={(e) => { const f = at(e); if (e.pointerType === 'mouse') setHover(f); if (drag != null) { setDrag(f); if (dur) v().currentTime = f * dur } }}
            onPointerLeave={() => setHover(null)}
            onPointerUp={(e) => { if (drag != null) { seekTo(at(e) * dur); setDrag(null) } }} onPointerCancel={() => setDrag(null)}>
            <div className={`relative w-full overflow-hidden rounded-full bg-white/25 transition-[height] ${drag != null ? 'h-1.5' : 'h-1 group-hover/seek:h-1.5'}`}>
              <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${dur ? Math.min(100, (buffered / dur) * 100) : 0}%` }} data-video-buffered />
              <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${frac * 100}%` }} />
            </div>
            <span className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${drag != null || touch.current ? 'scale-100' : 'scale-0 group-hover/seek:scale-100 group-focus-visible/seek:scale-100'}`} style={{ left: `${frac * 100}%` }} />
            {hover != null && dur > 0 && <span className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white" style={{ left: `${hover * 100}%` }}>{fmtTime(hover * dur)}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { toggle(); wake() }} className={btn} aria-label={playing ? t('Pause') : t('Play')} title={playing ? t('Pause') : t('Play')} data-video-toggle>
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            {/* Desktop: the slider opens beside the button on hover. Phones use the side buttons, so just mute. */}
            <div className="group/vol flex items-center">
              <button type="button" onClick={toggleMute} className={btn} aria-label={vol.muted ? t('Unmute') : t('Mute')} title={vol.muted ? t('Unmute') : t('Mute')} data-video-mute><VolIcon size={18} /></button>
              {!phone && (
                <div className="w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover/vol:w-[72px] group-hover/vol:opacity-100 group-focus-within/vol:w-[72px] group-focus-within/vol:opacity-100">
                  <input type="range" min={0} max={1} step={0.01} value={vol.muted ? 0 : vol.v} onChange={(e) => setVolume(Number(e.target.value))} aria-label={t('Volume')}
                    className="mx-1 block h-1 w-16 cursor-pointer accent-white" data-video-volume />
                </div>
              )}
            </div>
            <span className="ml-1 truncate rounded-md px-1 font-mono text-xs tabular-nums text-white/90" data-video-time>{fmtTime(frac * dur)} / {fmtTime(dur)}</span>
            <span className="flex-1" />
            <div className="relative">
              <button type="button" onClick={() => setSpeedOpen(!speedOpen)} className={`${btn} w-auto min-w-8 px-1.5 text-xs font-bold`} aria-label={t('Playback speed')} title={t('Playback speed')} aria-expanded={speedOpen} data-video-speed>{speed}x</button>
              {speedOpen && (
                <div className="absolute bottom-9 right-0 z-10 flex max-h-44 flex-col overflow-y-auto rounded-md bg-black/90 py-1 text-xs text-white shadow-lg" role="menu" data-video-speeds>
                  {SPEEDS.slice().reverse().map((s) => (
                    <button key={s} type="button" role="menuitemradio" aria-checked={s === speed} onClick={() => { setSpeed(s); setSpeedOpen(false); wake() }}
                      className={`px-4 py-1.5 text-left tabular-nums hover:bg-white/15 ${s === speed ? 'font-bold text-accent' : ''}`}>{s === 1 ? t('Normal') : `${s}x`}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={fullscreen} className={btn} aria-label={fs ? t('Exit full screen') : t('Full screen')} title={fs ? t('Exit full screen') : t('Full screen')} data-video-fullscreen>
              {fs ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      )}
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label={t('Video')} />}
    </div>
  )
}
