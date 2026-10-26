/// <reference lib="webworker" />
/**
 * End-to-end encryption of call media for peer-to-peer (mesh) calls: every encoded audio/video frame is sealed with
 * AES-GCM under the sender's own key before it leaves the browser, and opened with that sender's key on arrival.
 * Keys come from the main thread (lib/e2ee.ts), which agrees them with each peer; the server never sees them.
 *
 * Frame layout: [codec header, clear][ciphertext + 16-byte tag][12-byte IV][key index]. The first bytes stay in the
 * clear (and are authenticated as AAD) so the packetizer still recognises the frame: 1 byte of Opus TOC, 10 bytes of
 * a VP8 key frame, 3 of a VP8 delta frame (encrypted calls negotiate VP8). With no key for a frame it is dropped:
 * nothing is ever sent unencrypted, and nothing undecryptable reaches the decoder.
 */

type Mode = 'encrypt' | 'decrypt'
interface Options { mode: Mode; kind: 'audio' | 'video'; peer?: string }
type Frame = RTCEncodedAudioFrame | RTCEncodedVideoFrame
type Msg =
  | { op: 'own'; idx: number; raw: ArrayBuffer }
  | { op: 'peer'; id: string; idx: number; raw: ArrayBuffer }
  | { op: 'forget'; id: string }
  | { op: 'stream'; readable: ReadableStream<Frame>; writable: WritableStream<Frame>; options: Options }

const scope = self as unknown as DedicatedWorkerGlobalScope & { onrtctransform: ((e: Event & { transformer: Transformer }) => void) | null }
interface Transformer { readable: ReadableStream<Frame>; writable: WritableStream<Frame>; options: Options; generateKeyFrame?: () => Promise<void>; sendKeyFrameRequest?: () => Promise<void> }

const KEYS = 16
let own: { idx: number; key: CryptoKey } | null = null
const peers = new Map<string, Map<number, CryptoKey>>()
// Live script transformers, to ask for a fresh key frame once a key is in place (video can't start from a delta).
const transformers = new Set<Transformer>()

const importAes = (raw: ArrayBuffer) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

function clearBytes(opts: Options, frame: Frame): number {
  if (opts.kind === 'audio') return 1
  return (frame as RTCEncodedVideoFrame).type === 'key' ? 10 : 3
}

async function encrypt(frame: Frame, opts: Options): Promise<boolean> {
  if (!own) return false
  const data = new Uint8Array(frame.data)
  if (data.byteLength === 0) return true
  const h = Math.min(clearBytes(opts, frame), data.byteLength)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: data.subarray(0, h) }, own.key, data.subarray(h)))
  const out = new Uint8Array(h + sealed.byteLength + 13)
  out.set(data.subarray(0, h), 0)
  out.set(sealed, h)
  out.set(iv, h + sealed.byteLength)
  out[out.byteLength - 1] = own.idx
  frame.data = out.buffer
  return true
}

async function decrypt(frame: Frame, opts: Options): Promise<boolean> {
  const data = new Uint8Array(frame.data)
  if (data.byteLength === 0) return true
  const h = clearBytes(opts, frame)
  if (data.byteLength < h + 16 + 13) return false
  const key = peers.get(opts.peer ?? '')?.get(data[data.byteLength - 1])
  if (!key) return false
  const iv = data.subarray(data.byteLength - 13, data.byteLength - 1)
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: data.subarray(0, h) }, key, data.subarray(h, data.byteLength - 13)))
    const out = new Uint8Array(h + plain.byteLength)
    out.set(data.subarray(0, h), 0)
    out.set(plain, h)
    frame.data = out.buffer
    return true
  } catch { return false }
}

function pipe(readable: ReadableStream<Frame>, writable: WritableStream<Frame>, opts: Options) {
  readable.pipeThrough(new TransformStream<Frame, Frame>({
    async transform(frame, controller) {
      if (await (opts.mode === 'encrypt' ? encrypt(frame, opts) : decrypt(frame, opts))) controller.enqueue(frame)
    },
  })).pipeTo(writable).catch(() => { /* the connection closed */ })
}

scope.onrtctransform = (e) => {
  const t = e.transformer
  transformers.add(t)
  pipe(t.readable, t.writable, t.options)
}

scope.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.op === 'stream') { pipe(m.readable, m.writable, m.options); return }
  if (m.op === 'forget') { peers.delete(m.id); return }
  const key = await importAes(m.raw)
  if (m.op === 'own') {
    const first = !own
    own = { idx: m.idx % KEYS, key }
    if (first) transformers.forEach((t) => { if (t.options.mode === 'encrypt' && t.options.kind === 'video') t.generateKeyFrame?.().catch(() => {}) })
    return
  }
  let ring = peers.get(m.id)
  const first = !ring
  if (!ring) { ring = new Map(); peers.set(m.id, ring) }
  ring.set(m.idx % KEYS, key)
  if (first) transformers.forEach((t) => { if (t.options.mode === 'decrypt' && t.options.kind === 'video' && t.options.peer === m.id) t.sendKeyFrameRequest?.().catch(() => {}) })
}
