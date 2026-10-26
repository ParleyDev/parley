import { BaseKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client'

/**
 * End-to-end encrypted calls (channels with `e2ee` on).
 *
 * Every participant has a random 256-bit sender key that seals its own audio and video frames. Sender keys travel
 * pairwise over the call's signalling relay, wrapped with a secret only the two ends can compute: each side makes a
 * fresh P-256 ECDH key pair when it joins, swaps public keys (`e2ee_hello`), and derives an AES-GCM wrapping key with
 * HKDF (`e2ee_key` carries the wrapped sender key). The server relays all of it but can read none of it.
 *
 * A server that swapped public keys could sit in the middle, so the call shows a safety code: a hash of everyone's
 * public key. Everyone sees the same code unless someone is intercepting; people compare it out loud.
 *
 * Media: peer-to-peer calls run frames through lib/e2eeWorker.ts; LiveKit calls use LiveKit's own frame encryption
 * with these sender keys per participant (ParleyKeyProvider).
 */

export type E2eeSignal =
  | { type: 'e2ee_hello'; pub: string }
  | { type: 'e2ee_key'; idx: number; iv: string; key: string }

/** Somewhere sender keys go: the mesh worker or LiveKit's key provider. */
export interface KeySink {
  own(idx: number, raw: ArrayBuffer): void
  peer(id: string, idx: number, raw: ArrayBuffer): void
  forget(id: string): void
}

/** Whether this browser can encrypt call media end to end (encoded transforms in a worker). */
export function e2eeSupported(): boolean {
  if (typeof window === 'undefined' || typeof RTCRtpSender === 'undefined' || !window.isSecureContext) return false
  return 'RTCRtpScriptTransform' in window || 'createEncodedStreams' in RTCRtpSender.prototype
}

/** True when only the older Chrome API exists: peer connections must then be made with encodedInsertableStreams. */
export const legacyInsertableStreams = () => typeof window !== 'undefined' && !('RTCRtpScriptTransform' in window) && typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const enc = new TextEncoder()
const KEYS = 16

interface PeerState { pub: Uint8Array<ArrayBuffer>; wrap: Promise<CryptoKey> }

export class CallCrypto {
  private pair!: CryptoKeyPair
  private pub!: Uint8Array<ArrayBuffer>
  private sender = crypto.getRandomValues(new Uint8Array(32))
  private idx = 0
  private peers = new Map<string, PeerState>()
  private keyed = new Map<string, { idx: number; raw: ArrayBuffer }>()
  private helloSent = new Set<string>()
  private waiting = new Map<string, Array<Extract<E2eeSignal, { type: 'e2ee_key' }>>>()
  private sinks: KeySink[] = []
  private closed = false
  private readonly me: string
  private readonly send: (to: string, data: E2eeSignal) => void
  private readonly changed: () => void

  private constructor(me: string, send: (to: string, data: E2eeSignal) => void, changed: () => void) { this.me = me; this.send = send; this.changed = changed }

  static async create(me: string, send: (to: string, data: E2eeSignal) => void, changed: () => void): Promise<CallCrypto> {
    const c = new CallCrypto(me, send, changed)
    c.pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    c.pub = new Uint8Array(await crypto.subtle.exportKey('raw', c.pair.publicKey))
    return c
  }

  /** Hand keys to a media path; it gets our current key and every peer key so far. */
  attach(sink: KeySink) {
    this.sinks.push(sink)
    sink.own(this.idx, this.sender.slice().buffer)
    this.keyed.forEach((k, id) => sink.peer(id, k.idx, k.raw))
  }

  detach(sink: KeySink) { this.sinks = this.sinks.filter((s) => s !== sink) }

  /** Introduce ourselves to someone in the call (once per peer until they leave). */
  hello(to: string) {
    if (this.closed || to === this.me || this.helloSent.has(to)) return
    this.helloSent.add(to)
    this.send(to, { type: 'e2ee_hello', pub: b64(this.pub) })
  }

  async onSignal(from: string, data: E2eeSignal) {
    if (this.closed || from === this.me) return
    if (data.type === 'e2ee_hello') {
      const pub = unb64(data.pub)
      const prev = this.peers.get(from)
      if (prev && b64(prev.pub) === data.pub) return
      const wrap = this.deriveWrap(from, pub)
      this.peers.set(from, { pub, wrap })
      this.hello(from)
      try { await wrap } catch { this.peers.delete(from); return }
      await this.sendKey(from)
      for (const k of this.waiting.get(from) ?? []) await this.onSignal(from, k)
      this.waiting.delete(from)
      this.changed()
      return
    }
    const peer = this.peers.get(from)
    if (!peer) { this.waiting.set(from, [...(this.waiting.get(from) ?? []), data]); return }
    try {
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: enc.encode(`${from}>${this.me}:${data.idx}`) }, await peer.wrap, unb64(data.key))
      this.keyed.set(from, { idx: data.idx, raw })
      this.sinks.forEach((s) => s.peer(from, data.idx, raw))
      this.changed()
    } catch { /* not for this key pair (stale or tampered): ignore */ }
  }

  /** Someone left: forget their keys; with `rotate`, move to a new sender key so they can't follow along later. */
  remove(id: string, rotate = false) {
    this.peers.delete(id); this.keyed.delete(id); this.helloSent.delete(id); this.waiting.delete(id)
    this.sinks.forEach((s) => s.forget(id))
    if (rotate) this.rotate()
    this.changed()
  }

  /** New sender key: share it first, then start using it a moment later so frames never outrun the key. */
  rotate() {
    this.sender = crypto.getRandomValues(new Uint8Array(32))
    this.idx = (this.idx + 1) % KEYS
    const idx = this.idx, raw = this.sender.slice().buffer
    this.peers.forEach((_, id) => { this.sendKey(id) })
    setTimeout(() => { if (!this.closed && this.idx === idx) this.sinks.forEach((s) => s.own(idx, raw)) }, 1000)
  }

  /** People whose key we have (their media can be decrypted). */
  get keyedPeers(): string[] { return [...this.keyed.keys()] }

  /**
   * The call's safety code: 20 digits from a hash of every participant's public key. Everyone sees the same code
   * when nobody is in the middle; it changes whenever someone joins or leaves.
   */
  async safetyCode(): Promise<string> {
    const parts = [[this.me, b64(this.pub)], ...[...this.peers.entries()].map(([id, p]) => [id, b64(p.pub)])].sort((a, b) => a[0].localeCompare(b[0]))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(parts.map((p) => p.join(':')).join('|'))))
    const groups: string[] = []
    for (let i = 0; i < 5; i++) {
      const n = ((digest[i * 3] << 16) | (digest[i * 3 + 1] << 8) | digest[i * 3 + 2]) % 10000
      groups.push(String(n).padStart(4, '0'))
    }
    return groups.join(' ')
  }

  close() { this.closed = true; this.sinks = []; this.peers.clear(); this.keyed.clear() }

  private async deriveWrap(other: string, pub: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const theirs = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, this.pair.privateKey, 256)
    const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
    const ids = [this.me, other].sort().join('|')
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('parley-call-e2ee-v1'), info: enc.encode(ids) }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }

  private async sendKey(to: string) {
    const peer = this.peers.get(to)
    if (!peer || this.closed) return
    const idx = this.idx
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${this.me}>${to}:${idx}`) }, await peer.wrap, this.sender)
    this.send(to, { type: 'e2ee_key', idx, iv: b64(iv), key: b64(key) })
  }
}

/** Mesh calls: one worker seals and opens every frame on every peer connection. */
export class MeshCrypto implements KeySink {
  readonly worker = new Worker(new URL('./e2eeWorker.ts', import.meta.url), { type: 'module' })
  private done = new WeakSet<RTCRtpSender | RTCRtpReceiver>()
  own(idx: number, raw: ArrayBuffer) { this.worker.postMessage({ op: 'own', idx, raw }) }
  peer(id: string, idx: number, raw: ArrayBuffer) { this.worker.postMessage({ op: 'peer', id, idx, raw }) }
  forget(id: string) { this.worker.postMessage({ op: 'forget', id }) }
  close() { this.worker.terminate() }

  /** Put every sender and receiver of a connection through the worker (idempotent), and prefer VP8 for video. */
  secure(pc: RTCPeerConnection, peer: string) {
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track.kind as 'audio' | 'video'
      if (kind === 'video') preferVp8(t)
      this.attach(t.sender, { mode: 'encrypt', kind })
      this.attach(t.receiver, { mode: 'decrypt', kind, peer })
    }
  }

  private attach(end: RTCRtpSender | RTCRtpReceiver, options: { mode: 'encrypt' | 'decrypt'; kind: 'audio' | 'video'; peer?: string }) {
    if (this.done.has(end)) return
    this.done.add(end)
    const w = window as unknown as { RTCRtpScriptTransform?: new (worker: Worker, options: unknown) => unknown }
    if (w.RTCRtpScriptTransform) {
      (end as unknown as { transform: unknown }).transform = new w.RTCRtpScriptTransform(this.worker, options)
      return
    }
    const { readable, writable } = (end as unknown as { createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } }).createEncodedStreams()
    this.worker.postMessage({ op: 'stream', readable, writable, options }, [readable as unknown as Transferable, writable as unknown as Transferable])
  }
}

/** The clear-header layout in the worker assumes VP8; put it first so both ends pick it. */
function preferVp8(t: RTCRtpTransceiver) {
  const caps = typeof RTCRtpReceiver.getCapabilities === 'function' ? RTCRtpReceiver.getCapabilities('video') : null
  if (!caps || typeof t.setCodecPreferences !== 'function') return
  const vp8 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp8')
  if (!vp8.length) return
  const rest = caps.codecs.filter((c) => /\/(rtx|red|ulpfec)$/i.test(c.mimeType))
  try { t.setCodecPreferences([...vp8, ...rest]) } catch { /* unsupported combination: keep the browser default */ }
}

/** LiveKit calls: hands our sender keys to LiveKit's frame encryption, one key ring per participant. */
export class ParleyKeyProvider extends BaseKeyProvider implements KeySink {
  private readonly me: string
  constructor(me: string) { super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: KEYS }); this.me = me }
  own(idx: number, raw: ArrayBuffer) { this.set(this.me, idx, raw) }
  peer(id: string, idx: number, raw: ArrayBuffer) { this.set(id, idx, raw) }
  forget() { /* LiveKit drops a participant's keys when they leave the room */ }
  private set(id: string, idx: number, raw: ArrayBuffer) { createKeyMaterialFromBuffer(raw).then((k) => this.onSetEncryptionKey(k, id, idx)).catch(() => {}) }
}
