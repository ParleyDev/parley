import { useSyncExternalStore } from 'react'
import { getPrefs, subscribePrefs } from './prefs'
import { voice } from './voice'
import { useStore } from '../store'
import { t } from './i18n'

/**
 * Clips: while Clips are on and you're in a call, a few overlapping recorders keep the last stretch ready; saving
 * stops the one that started about the clip length ago, so the file holds that much (a little more at most). What
 * it records: the stream you're watching (or your own share) with the call's sound and, if chosen, your voice; with
 * no stream, just the sound. Clips stay on this device (IndexedDB) until you delete them.
 */
export interface Clip { id: string; at: number; seconds: number; mime: string; blob: Blob; title: string }

interface Ring { rec: MediaRecorder; chunks: Blob[]; startedAt: number }

let rings: Ring[] = []
let ctx: AudioContext | null = null
let signature = ''
let timer: ReturnType<typeof setInterval> | null = null
let stream: MediaStream | null = null
let lastStart = 0

/** Clip length; tests shorten it. */
const length = () => (window as unknown as { __parleyClipSeconds?: number }).__parleyClipSeconds ?? getPrefs().clipSeconds

/** What to film: a stream you're watching, else your own share. */
function videoSource(): { track: MediaStreamTrack; who: string } | null {
  const s = useStore.getState()
  for (const uid of Object.keys(s.watching)) {
    const tr = s.remoteMedia[uid]?.screen?.getVideoTracks().find((x) => x.readyState === 'live')
    if (tr) return { track: tr, who: uid }
  }
  const own = s.localScreen?.getVideoTracks().find((x) => x.readyState === 'live')
  return own && s.user ? { track: own, who: s.user.id } : null
}

function stopAll() {
  for (const r of rings) { try { r.rec.stop() } catch { /* already stopped */ } }
  rings = []
  void ctx?.close(); ctx = null; stream = null; signature = ''
}

/** (Re)build what the recorders record: the video track plus one mixed sound track. */
function build(video: MediaStreamTrack | null) {
  stopAll()
  ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const p = getPrefs()
  const { remote, mine } = voice.clipAudio()
  if (p.clipVoices) for (const st of remote) ctx.createMediaStreamSource(st).connect(dest)
  if (p.clipMyVoice && mine?.getAudioTracks().length) ctx.createMediaStreamSource(mine).connect(dest)
  stream = new MediaStream([...(video ? [video] : []), ...dest.stream.getAudioTracks()])
}

function mimeFor(video: boolean) {
  const opts = video ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return opts.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
}

function startOne() {
  if (!stream) return
  const mime = mimeFor(stream.getVideoTracks().length > 0)
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const r: Ring = { rec, chunks: [], startedAt: Date.now() }
  rec.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data) }
  rec.start(1000)
  rings.push(r)
  lastStart = r.startedAt
}

/** Once a second: follow the call and the stream, start a recorder every half clip, drop ones too old to need. */
function tick() {
  const s = useStore.getState()
  const on = getPrefs().clips && !!s.myVoiceChannelId && typeof MediaRecorder !== 'undefined'
  if (!on) { if (rings.length || ctx) stopAll(); return }
  const v = videoSource()
  const { remote, mine } = voice.clipAudio()
  const p = getPrefs()
  const sig = [v?.track.id ?? '-', p.clipVoices ? remote.map((x) => x.id).join(',') : '', p.clipMyVoice ? mine?.id ?? '' : ''].join('|')
  if (sig !== signature) { build(v?.track ?? null); signature = sig; startOne() }
  const n = length() * 1000, step = Math.max(1000, n / 2)
  if (Date.now() - lastStart >= step) startOne()
  const keep = n + step + 1500
  rings = rings.filter((r) => { if (Date.now() - r.startedAt <= keep) return true; try { r.rec.stop() } catch { /* ignore */ } return false })
}

export function initClips() {
  if (timer) return
  timer = setInterval(tick, 1000)
  subscribePrefs(() => tick())
}

/** Save the last stretch as a clip. */
export async function saveClip(): Promise<Clip | null> {
  const st = useStore.getState()
  if (!getPrefs().clips) { st.pushToast(t('Turn on Clips in Settings → Clips first.'), 'error'); return null }
  if (!st.myVoiceChannelId || !rings.length) { st.pushToast(t('Clips record while you are in a call.'), 'error'); return null }
  const n = length() * 1000, now = Date.now()
  // The youngest recorder that already covers the clip length, or the oldest one there is.
  const old = rings.filter((r) => now - r.startedAt >= n)
  const pick = old.length ? old[old.length - 1] : rings[0]
  rings = rings.filter((r) => r !== pick)
  const blob = await new Promise<Blob>((resolve) => {
    pick.rec.onstop = () => resolve(new Blob(pick.chunks, { type: pick.rec.mimeType || 'video/webm' }))
    try { pick.rec.stop() } catch { resolve(new Blob(pick.chunks, { type: pick.rec.mimeType })) }
  })
  if (rings.length === 0) startOne()
  const v = videoSource()
  const who = v ? (st.users[v.who]?.display_name ?? '') : ''
  const channel = st.myVoiceChannelId ? st.channels[st.myVoiceChannelId]?.name ?? '' : ''
  const clip: Clip = { id: crypto.randomUUID(), at: now, seconds: Math.round((now - pick.startedAt) / 1000), mime: blob.type, blob, title: who ? t('{name} in {channel}', { name: who, channel }) : channel }
  await db.put(clip)
  st.pushToast(t('Clip saved: Settings → Clips'))
  return clip
}

// ---- storage: IndexedDB, newest 30 kept ----
const MAX = 30
const listeners = new Set<() => void>()
let cache: Clip[] | null = null
const emit = () => listeners.forEach((f) => f())

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('parley-clips', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('clips', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
const tx = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const d = await open()
  return new Promise((resolve, reject) => { const r = f(d.transaction('clips', mode).objectStore('clips')); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
const db = {
  async list(): Promise<Clip[]> { return ((await tx<Clip[]>('readonly', (s) => s.getAll() as IDBRequest<Clip[]>)) ?? []).sort((a, b) => b.at - a.at) },
  async put(c: Clip) {
    await tx('readwrite', (s) => s.put(c))
    const all = await db.list()
    for (const x of all.slice(MAX)) await tx('readwrite', (s) => s.delete(x.id))
    cache = all.slice(0, MAX); emit()
  },
}
export async function deleteClip(id: string) { await tx('readwrite', (s) => s.delete(id)); cache = (cache ?? []).filter((c) => c.id !== id); emit() }
export function useClips(): Clip[] | null {
  return useSyncExternalStore((f) => { listeners.add(f); if (!cache) void db.list().then((l) => { cache = l; emit() }).catch(() => { cache = []; emit() }); return () => { listeners.delete(f) } }, () => cache)
}
