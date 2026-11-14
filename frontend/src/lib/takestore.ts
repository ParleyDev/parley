import { create } from 'zustand'
import { getToken } from './api'

/**
 * Where a take lives between the microphone and the server. The recorder (lib/studio.ts) writes the audio here, on
 * this device, as it is captured: uncompressed blocks in IndexedDB, each at its byte offset in the take. From here it
 * is sent in order, every piece at the offset the server has reached; the server takes a piece only there, so a piece
 * lost, repeated or late can neither leave a hole nor double the audio. What the server has is removed here. Whatever
 * goes wrong on the way (the network, the server, this page closing) the audio is still here, and the sending picks
 * up where it was: now, when the network is back, or the next time the app is opened.
 */
export interface TakeMeta {
  /** The take's track on the server (chosen here, so creating it twice is creating it once). */
  id: string; session: string; user: string
  /** The lane it records ('' for a member with no track of their own yet). */
  lane: string
  rate: number; channels: number; offset_ms: number; latency_ms: number
  /** Captured through the call's voice processing (no clean input could be opened). */
  processed: boolean
  /** Bytes captured so far; final once `ended`. */
  bytes: number; ended: boolean
  /** When this was last written: a take left open by a page that is gone goes stale. */
  at: number
}
type Block = { take: string; offset: number; data: ArrayBuffer }

/** What the studio shows of a take of mine that is not on the server in full yet. */
export interface TakeState {
  id: string; session: string; lane: string
  state: 'recording' | 'uploading' | 'retrying' | 'done' | 'failed'
  /** Bytes captured, and how many of them the server has. */
  bytes: number; acked: number
  /** Recorded with the browser's compressed recorder: this device could not capture PCM. */
  compressed: boolean; processed: boolean
}
/** The input an armed track of mine listens to: its name, or why it could not be opened. */
export interface TakeInput { name: string; processed: boolean; error?: string }
export const useTakes = create<{ takes: Record<string, TakeState>; inputs: Record<string, TakeInput> }>(() => ({ takes: {}, inputs: {} }))

export function noteTake(id: string, patch: Partial<TakeState>) {
  useTakes.setState((s) => ({ takes: { ...s.takes, [id]: { ...(s.takes[id] ?? { session: '', lane: '', state: 'recording', bytes: 0, acked: 0, compressed: false, processed: false }), ...patch, id } } }))
  // A finished take stays in view for a moment, then it is the clip that speaks for it (a failure, a little longer).
  if (patch.state === 'done' || patch.state === 'failed') setTimeout(() => useTakes.setState((s) => { const takes = { ...s.takes }; delete takes[id]; return { takes } }), patch.state === 'done' ? 4000 : 15_000)
}

// ---- storage ----

const mem = { takes: new Map<string, TakeMeta>(), blocks: new Map<string, Block[]>() }
let opened: Promise<IDBDatabase | null> | null = null
/** The database, or null where there is none (private windows of some browsers): takes are then held in memory. */
function db(): Promise<IDBDatabase | null> {
  return (opened ??= new Promise((res) => {
    try {
      const req = indexedDB.open('parley-takes', 1)
      req.onupgradeneeded = () => { req.result.createObjectStore('takes', { keyPath: 'id' }); req.result.createObjectStore('blocks', { keyPath: ['take', 'offset'] }) }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
      req.onblocked = () => res(null)
    } catch { res(null) }
  }))
}
const done = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const blocksOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])

export const takeStore = {
  async put(m: TakeMeta) {
    const d = await db()
    if (!d) { mem.takes.set(m.id, m); return }
    await done(d.transaction('takes', 'readwrite').objectStore('takes').put(m))
  },
  async get(id: string): Promise<TakeMeta | undefined> {
    const d = await db()
    return d ? done<TakeMeta | undefined>(d.transaction('takes').objectStore('takes').get(id)) : mem.takes.get(id)
  },
  async list(): Promise<TakeMeta[]> {
    const d = await db()
    return d ? done<TakeMeta[]>(d.transaction('takes').objectStore('takes').getAll()) : [...mem.takes.values()]
  },
  /** Keep a block of the take's audio at its byte offset. */
  async add(id: string, offset: number, data: Uint8Array) {
    const b: Block = { take: id, offset, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }
    const d = await db()
    if (!d) { const l = mem.blocks.get(id) ?? []; l.push(b); mem.blocks.set(id, l); return }
    await done(d.transaction('blocks', 'readwrite').objectStore('blocks').put(b))
  },
  /** The audio from byte `from` on, up to about `max` bytes (none when the audio at `from` is not here). */
  async read(id: string, from: number, max: number): Promise<{ data: Uint8Array }> {
    const parts: Uint8Array[] = []
    let at = from
    const take = (b: Block) => {
      const end = b.offset + b.data.byteLength
      if (end <= at) return true
      if (b.offset > at) return false
      parts.push(new Uint8Array(b.data, at - b.offset)); at = end
      return at - from < max
    }
    const d = await db()
    if (!d) { for (const b of mem.blocks.get(id) ?? []) if (!take(b)) break }
    else await new Promise<void>((res, rej) => {
      const cur = d.transaction('blocks').objectStore('blocks').openCursor(blocksOf(id))
      cur.onsuccess = () => { const c = cur.result; if (c && take(c.value as Block)) c.continue(); else res() }
      cur.onerror = () => rej(cur.error)
    })
    const data = new Uint8Array(at - from)
    let o = 0
    for (const p of parts) { data.set(p, o); o += p.length }
    return { data }
  },
  /** Where the audio held here ends (a take whose page closed before it could say). */
  async extent(id: string): Promise<number> {
    const d = await db()
    if (!d) return (mem.blocks.get(id) ?? []).reduce((m, b) => Math.max(m, b.offset + b.data.byteLength), 0)
    return new Promise<number>((res, rej) => {
      const cur = d.transaction('blocks').objectStore('blocks').openCursor(blocksOf(id), 'prev')
      cur.onsuccess = () => { const b = cur.result?.value as Block | undefined; res(b ? b.offset + b.data.byteLength : 0) }
      cur.onerror = () => rej(cur.error)
    })
  },
  /** Forget the blocks the server has in full. */
  async drop(id: string, acked: number) {
    const d = await db()
    if (!d) { const l = mem.blocks.get(id); if (l) mem.blocks.set(id, l.filter((b) => b.offset + b.data.byteLength > acked)); return }
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('blocks', 'readwrite')
      const cur = tx.objectStore('blocks').openCursor(blocksOf(id))
      cur.onsuccess = () => { const c = cur.result; if (c && (c.value as Block).offset + (c.value as Block).data.byteLength <= acked) { c.delete(); c.continue() } }
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  },
  async remove(id: string) {
    const d = await db()
    if (!d) { mem.takes.delete(id); mem.blocks.delete(id); return }
    const tx = d.transaction(['takes', 'blocks'], 'readwrite')
    tx.objectStore('takes').delete(id)
    tx.objectStore('blocks').delete(blocksOf(id))
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  },
}

/** Room left for takes on this device in bytes, or null where the browser does not say. Asks it to keep them. */
export async function takeRoom(): Promise<number | null> {
  try {
    void navigator.storage?.persist?.().catch(() => false)
    const e = await navigator.storage?.estimate?.()
    return e?.quota ? Math.max(0, e.quota - (e.usage ?? 0)) : null
  } catch { return null }
}

// ---- sending ----

/** About this much audio per request. */
const PIECE = 4 * 1024 * 1024
const running = new Set<string>()
const waiting = new Map<string, () => void>()
const sleep = (id: string, ms: number) => new Promise<void>((res) => { const t = setTimeout(go, ms); function go() { clearTimeout(t); waiting.delete(id); res() } waiting.set(id, go) })

async function call(method: string, path: string, body?: BodyInit, json = false): Promise<Response> {
  const token = getToken()
  return fetch(`/api${path}`, { method, body, headers: { ...(body ? { 'Content-Type': json ? 'application/json' : 'application/octet-stream' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
}
/** The server cannot answer now, but may later. */
const later = (status: number) => status >= 500 || status === 429 || status === 408

/** There is more of this take to send, or it has ended: send (if not already sending). */
export function sendTake(id: string) {
  waiting.get(id)?.()
  if (running.has(id)) return
  running.add(id)
  const go = () => run(id).catch(() => {}).finally(() => { running.delete(id) })
  // One page sends a take at a time: another tab that finds it leaves it alone.
  if (navigator.locks) void navigator.locks.request(`parley-take-${id}`, { ifAvailable: true }, async (l) => { if (l) await go(); else running.delete(id) })
  else void go()
}

async function run(id: string) {
  let acked = -1, fails = 0, refused = 0
  for (;;) {
    const m = await takeStore.get(id)
    if (!m) return
    const base = `/studio/sessions/${m.session}/tracks`
    try {
      if (acked < 0) {
        // Its track on the server, and how much of it is there already.
        const made = await call('POST', base, JSON.stringify({ id, offset_ms: m.offset_ms, latency_ms: m.latency_ms, content_type: 'audio/wav', sample_rate: m.rate, channels: m.channels, bits: 24, processed: m.processed, ...(m.lane ? { lane_id: m.lane } : {}) }), true)
        if (later(made.status)) throw new Error(String(made.status))
        if (!made.ok) {
          // Refused: for a moment (the call is reconnecting, the track was just disarmed), or for good.
          if (!refused) refused = Date.now()
          if (Date.now() - refused < (m.ended ? 20_000 : 120_000)) throw new Error(String(made.status))
          return void await fail(m)
        }
        const st = await call('GET', `${base}/${id}`)
        if (!st.ok) throw new Error(String(st.status))
        acked = ((await st.json()) as { received: number }).received
        await takeStore.drop(id, acked)
      }
      const { data } = await takeStore.read(id, acked, PIECE)
      if (data.length) {
        const r = await call('POST', `${base}/${id}/chunks?offset=${acked}`, data as Uint8Array<ArrayBuffer>)
        if (r.status === 409 || r.ok) {
          // Taken, or the server is somewhere else in the take (a piece arrived whose answer was lost): go from there.
          const now = ((await r.json()) as { received?: number }).received
          if (typeof now !== 'number') throw new Error('409')
          acked = now
          await takeStore.drop(id, acked)
        } else if (later(r.status)) throw new Error(String(r.status))
        else return void await fail(m)
        fails = 0
        noteTake(id, { session: m.session, lane: m.lane, processed: m.processed, bytes: Math.max(m.bytes, acked), acked, ...(m.ended ? { state: 'uploading' } : {}) })
        continue
      }
      if (m.ended) {
        // All of it is there (or all there is: audio this device no longer holds cannot be sent).
        const r = await call('POST', `${base}/${id}/finish`, JSON.stringify({ bytes: Math.min(acked, m.bytes) }), true)
        if (r.status === 409) { const now = ((await r.json()) as { received?: number }).received; if (typeof now === 'number' && now < acked) { acked = now; continue } }
        else if (later(r.status)) throw new Error(String(r.status))
        await takeStore.remove(id)
        noteTake(id, { session: m.session, lane: m.lane, bytes: m.bytes, acked, state: acked < m.bytes ? 'failed' : 'done' })
        return
      }
      // Still recording: wait for more.
      await sleep(id, 2000)
    } catch {
      // The network or the server: the audio stays here, and this tries again, a little later each time.
      fails++
      noteTake(id, { session: m.session, lane: m.lane, processed: m.processed, bytes: m.bytes, ...(acked >= 0 ? { acked } : {}), ...(m.ended ? { state: 'retrying' } : {}) })
      await sleep(id, Math.min(15_000, 500 * 2 ** Math.min(fails, 5)))
    }
  }
}

async function fail(m: TakeMeta) {
  await takeStore.remove(m.id)
  noteTake(m.id, { session: m.session, lane: m.lane, bytes: m.bytes, state: 'failed' })
}

/**
 * Takes left here by a page that closed (or lost the server) before they were sent: finish sending them. A take whose
 * page went away mid-recording ends where its audio ends.
 */
const STALE = 10_000
let again: ReturnType<typeof setTimeout> | null = null
export async function recoverTakes(user: string) {
  for (const m of await takeStore.list().catch(() => [] as TakeMeta[])) {
    if (m.user !== user || running.has(m.id)) continue
    // Being recorded by another tab right now (it writes several times a second), or by a page that has just gone:
    // look again when it is clear which.
    if (!m.ended && Date.now() - m.at < STALE) { if (!again) again = setTimeout(() => { again = null; void recoverTakes(user) }, STALE + 1000); continue }
    const claim = async () => {
      const now = await takeStore.get(m.id)
      if (!now) return
      if (!now.ended) await takeStore.put({ ...now, ended: true, bytes: await takeStore.extent(m.id) })
      noteTake(m.id, { session: m.session, lane: m.lane, processed: m.processed, bytes: now.bytes, state: 'uploading' })
    }
    if (navigator.locks) await navigator.locks.request(`parley-take-${m.id}`, { ifAvailable: true }, async (l) => { if (l) await claim() })
    else await claim()
    sendTake(m.id)
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => waiting.forEach((go) => go()))
