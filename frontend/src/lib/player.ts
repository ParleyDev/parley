import { useSyncExternalStore } from 'react'
import { api } from './api'

/**
 * One audio player for the whole app. Audio attachments and voice messages play through it rather than an <audio> in
 * the message, so leaving the chat (another channel, a DM, Friends) doesn't stop them: the now-playing bar above the
 * user panel keeps the controls. Starting one thing stops whatever else was playing.
 */
export interface Track {
  /** The attachment id. */
  id: string
  url: string
  title: string
  /** Who posted it, for the now-playing bar and the lock screen. */
  artist?: string
  /** Where it was posted, so the now-playing bar can go back there. */
  where?: { guildId: string | null; channelId: string; messageId: string }
  /** Report "listened" past 80% (voice messages from someone else). */
  listen?: boolean
}
export interface PlayerState {
  track: Track | null
  playing: boolean
  /** Seconds. */
  pos: number
  duration: number
  speed: number
  volume: number
}

const LISTENED_AT = 0.8
let state: PlayerState = { track: null, playing: false, pos: 0, duration: 0, speed: 1, volume: readVolume() }
const subs = new Set<() => void>()
const set = (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; subs.forEach((f) => f()) }
const reported = new Set<string>()

function readVolume() { try { const v = Number(localStorage.getItem('parley.playerVolume')); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1 } catch { return 1 } }

let el: HTMLAudioElement | null = null
function audio(): HTMLAudioElement {
  if (el) return el
  el = document.createElement('audio')
  el.preload = 'metadata'; el.dataset.player = ''; el.volume = state.volume
  el.addEventListener('play', () => set({ playing: true }))
  el.addEventListener('pause', () => set({ playing: false }))
  el.addEventListener('loadedmetadata', () => set({ duration: Number.isFinite(el!.duration) ? el!.duration : 0 }))
  el.addEventListener('durationchange', () => { if (Number.isFinite(el!.duration)) set({ duration: el!.duration }) })
  el.addEventListener('timeupdate', () => {
    set({ pos: el!.currentTime })
    const tr = state.track
    if (tr?.listen && !reported.has(tr.id) && state.duration && el!.currentTime / state.duration >= LISTENED_AT) {
      reported.add(tr.id)
      api.post(`/attachments/${tr.id}/listened`).catch(() => reported.delete(tr.id))
    }
  })
  el.addEventListener('ended', () => {
    const tr = state.track
    if (tr?.listen && !reported.has(tr.id)) { reported.add(tr.id); api.post(`/attachments/${tr.id}/listened`).catch(() => reported.delete(tr.id)) }
    set({ playing: false, pos: state.duration })
    // A moment at the end (the bar fills), then the player clears.
    setTimeout(() => { if (state.track === tr && el!.paused) stop() }, 500)
  })
  document.body.append(el)
  return el
}

// Live visualisation: one analyser on the shared element. Only for files from this origin: a cross-origin file
// routed through Web Audio without CORS would play as silence. Never on iOS: WebKit treats an element routed through
// Web Audio as Web Audio, which stops when the app goes to the background (and obeys the silent switch); there the
// visualiser runs its synthetic motion and the file keeps playing behind the lock screen.
let ctx: AudioContext | null = null
let node: AnalyserNode | null = null
const sameOrigin = (url: string) => { try { return new URL(url, location.href).origin === location.origin } catch { return false } }
const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
function wire() {
  if (node || !state.track || !sameOrigin(state.track.url) || ios()) return
  try {
    ctx = new AudioContext()
    const src = ctx.createMediaElementSource(audio())
    node = ctx.createAnalyser(); node.fftSize = 256; node.smoothingTimeConstant = 0.78
    src.connect(node); node.connect(ctx.destination)
    audio().dataset.analysed = ''
  } catch { node = null }
}
/** The analyser for the visualiser, when the playing file can be analysed. */
export const analyser = () => (state.track && sameOrigin(state.track.url) ? node : null)

function mediaSession() {
  const ms = navigator.mediaSession
  if (!ms || !state.track) return
  try {
    ms.metadata = new MediaMetadata({ title: state.track.title, artist: state.track.artist ?? 'Parley' })
    ms.setActionHandler('play', () => void resume())
    ms.setActionHandler('pause', () => audio().pause())
    ms.setActionHandler('stop', () => stop())
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime) })
  } catch { /* older browsers */ }
}

async function resume() {
  const a = audio()
  if (!node) wire()
  if (ctx?.state === 'suspended') await ctx.resume().catch(() => {})
  a.playbackRate = state.speed
  await a.play().catch(() => set({ playing: false }))
}

/** Play `track` from `at` seconds (default: where it was, if it's the current one). */
export async function play(track: Track, opts: { at?: number; speed?: number } = {}) {
  const a = audio()
  if (state.track?.id !== track.id) {
    a.pause()
    a.src = track.url
    set({ track, pos: opts.at ?? 0, duration: 0, speed: opts.speed ?? 1 })
    if (opts.at) { const at = opts.at; a.addEventListener('loadedmetadata', () => { a.currentTime = at }, { once: true }) }
    mediaSession()
  } else {
    if (opts.speed) set({ speed: opts.speed })
    if (opts.at != null) a.currentTime = opts.at
  }
  // Something else playing on the page (another video) gives way.
  document.querySelectorAll<HTMLMediaElement>('video, audio:not([data-player])').forEach((m) => { if (!m.paused && !m.muted) m.pause() })
  await resume()
}

/** Play/pause `track` (starting it if something else is current). */
export function toggle(track: Track, opts: { speed?: number } = {}) {
  if (state.track?.id === track.id && state.playing) audio().pause()
  else void play(track, opts)
}
export const pause = () => { if (el && !el.paused) el.pause() }
export function seekTo(sec: number) { const a = audio(); a.currentTime = Math.max(0, Math.min(sec, state.duration || sec)); set({ pos: a.currentTime }) }
/** Seek within `track`: the current one jumps, another one starts there. */
export function seek(track: Track, sec: number) { if (state.track?.id === track.id) seekTo(sec); else void play(track, { at: sec }) }
export function setSpeed(speed: number) { set({ speed }); if (el) el.playbackRate = speed }
export function setVolume(volume: number) { set({ volume }); if (el) el.volume = volume; try { localStorage.setItem('parley.playerVolume', String(volume)) } catch { /* ignore */ } }
export function stop() {
  if (el) { el.pause(); el.removeAttribute('src'); el.load() }
  set({ track: null, playing: false, pos: 0, duration: 0 })
  try { if (navigator.mediaSession) navigator.mediaSession.metadata = null } catch { /* ignore */ }
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const usePlayer = () => useSyncExternalStore(subscribe, () => state)
/** The player's state when `id` is the current track, else null. */
export function usePlaying(id: string): PlayerState | null {
  const s = usePlayer()
  return s.track?.id === id ? s : null
}
export const playerState = () => state
