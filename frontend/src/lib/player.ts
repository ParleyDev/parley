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
  /** Count plays (audio files from someone else): see `countPlays`. */
  count?: boolean
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

/**
 * Play counting: a play counts once it has been heard from the start for 30 s, or half of a shorter track. Only time
 * actually played adds up (seeking ahead doesn't), and going back to the start (or playing it again after it ended)
 * begins a new play that can count again. Starting partway through doesn't count.
 */
const PLAY_SECONDS = 30
let listening: { id: string; heard: number; last: number; done: boolean; jumped?: boolean } | null = null
function countPlays(t: number) {
  const tr = state.track
  if (!tr?.count) return
  if (!listening || listening.id !== tr.id || (t < 1 && listening.last > 2)) listening = { id: tr.id, heard: 0, last: t, done: t > 2 }
  // Any forward movement that isn't a seek was played, even a long gap (timeupdate is sparse in the background).
  const d = t - listening.last
  if (d > 0 && !listening.jumped) listening.heard += d
  listening.last = t
  if (!listening.done && state.duration && listening.heard >= Math.min(PLAY_SECONDS, state.duration / 2)) {
    listening.done = true
    api.post(`/attachments/${tr.id}/played`).catch(() => {})
  }
}

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
  // Jumps aren't listening; a jump back to the start begins a new play.
  el.addEventListener('seeking', () => { if (listening) { if (el!.currentTime < 1) listening = null; else listening.jumped = true } })
  el.addEventListener('seeked', () => { if (listening) { listening.jumped = false; listening.last = el!.currentTime } })
  el.addEventListener('timeupdate', () => {
    set({ pos: el!.currentTime })
    countPlays(el!.currentTime)
    const tr = state.track
    if (tr?.listen && !reported.has(tr.id) && state.duration && el!.currentTime / state.duration >= LISTENED_AT) {
      reported.add(tr.id)
      api.post(`/attachments/${tr.id}/listened`).catch(() => reported.delete(tr.id))
    }
  })
  el.addEventListener('ended', () => {
    const tr = state.track
    listening = null
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
    node = ctx.createAnalyser(); node.fftSize = 2048; node.smoothingTimeConstant = 0.78
    src.connect(node); node.connect(ctx.destination)
    audio().dataset.analysed = ''
  } catch { node = null }
}
/**
 * Visualiser data made by the server (backend audio_viz.rs): a timeline of frequency bands the visualiser replays in
 * step with the stream, so it reacts to the music on every platform without Web Audio, plus a peak waveform for seek
 * bars. A few KB per minute; the audio itself still streams once.
 */
export interface Viz { fps: number; bands: number; offset: number; frames: number; peaks: Uint8Array; data: Uint8Array }
export function parseViz(buf: ArrayBuffer): Viz | null {
  const b = new Uint8Array(buf)
  if (b.length < 16 || String.fromCharCode(...b.subarray(0, 4)) !== 'PVZ1') return null
  const v = new DataView(buf)
  const fps = b[4], bands = b[5], offset = v.getUint16(6, true) / 1000, frames = v.getUint32(8, true), np = v.getUint16(12, true)
  const peaks = b.subarray(16, 16 + np), data = b.subarray(16 + np)
  return { fps, bands, offset, frames: Math.min(frames, Math.floor(data.length / Math.max(1, bands))), peaks, data }
}
/** `/api/attachments/<id>/<file>` → its visualiser data. */
export const vizUrl = (url: string, peaksOnly = false) => url.replace(/\/[^/?#]+(?:[?#].*)?$/, '/viz') + (peaksOnly ? '?peaks=1' : '')
const vizCache = new Map<string, Promise<Viz | null>>()
export function loadViz(url: string, peaksOnly = false): Promise<Viz | null> {
  const key = vizUrl(url, peaksOnly)
  let p = vizCache.get(key)
  if (!p) {
    p = fetch(key).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? parseViz(b) : null)).catch(() => null)
    p.then((v) => { if (!v) setTimeout(() => vizCache.delete(key), 30_000) })
    vizCache.set(key, p)
  }
  return p
}
let timelineFor: string | null = null, timelineData: Viz | null = null
/** The playing track's visualiser timeline, once it has arrived. */
export const timeline = () => (state.track && timelineFor === state.track.id ? timelineData : null)
/** The playhead right now (smoother than the state's, which moves on timeupdate). */
export const currentTime = () => el?.currentTime ?? 0

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
    // Starting partway through isn't a play.
    listening = opts.at && opts.at > 2 ? { id: track.id, heard: 0, last: opts.at, done: true } : null
    set({ track, pos: opts.at ?? 0, duration: 0, speed: opts.speed ?? 1 })
    timelineFor = null; timelineData = null
    void loadViz(track.url).then((v) => { if (v && state.track?.id === track.id) { timelineFor = track.id; timelineData = v } })
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
  listening = null
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
