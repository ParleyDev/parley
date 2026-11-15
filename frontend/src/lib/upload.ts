import { useStore } from '../store'
import { getToken } from './api'
import type { Attachment, UploadedImage } from './types'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
/** The largest single upload allowed right now: the user's override, else the instance setting, else 25 MB. */
export function maxUploadBytes(): number {
  const s = useStore.getState()
  const over = s.user?.max_upload_bytes
  if (over && over > 0) return over
  const inst = s.instance.max_upload_bytes
  return inst && inst > 0 ? inst : MAX_FILE_BYTES
}
export const MAX_PER_MESSAGE = 10
/** Over this, an upload cut off on the way is likely a proxy's request limit (Cloudflare: 100 MB on its common plans). */
const PROXY_HINT_BYTES = 100 * 1000 * 1000

export interface UploadHandle { promise: Promise<Attachment>; abort: () => void }

/** Files over this go up in parts: each request stays under a proxy's limit, and a dropped connection resumes. */
const PARTS_FROM = 48 * 1024 * 1024
const CUT_OFF = 'The upload was cut off before it finished: check the connection and try again'
const CUT_OFF_BIG = 'The upload was cut off before it finished: a proxy in front of the server may refuse files this large'

/** Upload one file to a channel with progress (XHR, since fetch has no upload progress); a large one in parts. */
export function uploadFile(channelId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  if (file.size > PARTS_FROM && file.size <= maxUploadBytes()) return uploadInParts(channelId, file, onProgress)
  const xhr = new XMLHttpRequest()
  // Cancelled here (the file removed, or re-uploaded as a spoiler), or cut off on the way: the browser reports both as
  // an abort. A proxy in front of the server (Cloudflare's plans stop at 100 MB a request) cuts off larger files.
  let cancelled = false
  const promise = new Promise<Attachment>((resolve, reject) => {
    if (file.size > maxUploadBytes()) { reject(new Error(`File too large (max ${formatBytes(maxUploadBytes())})`)); return }
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.open('POST', `/api/channels/${channelId}/attachments`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)) } catch { reject(new Error('Bad server response')) }
      } else {
        let msg = `Upload failed (${xhr.status})`
        try { msg = JSON.parse(xhr.responseText).error ?? msg } catch { /* keep */ }
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(new Error(cancelled ? 'Upload cancelled' : file.size > PROXY_HINT_BYTES ? CUT_OFF_BIG : CUT_OFF))
    xhr.send(form)
  })
  return { promise, abort: () => { cancelled = true; xhr.abort() } }
}

type PartsState = { id: string; size: number; received: number; part_bytes: number; attachment?: Attachment }
/** A refusal from the server (as opposed to the connection dropping), with its status. */
class Refused extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status } }

/**
 * A file uploaded in parts (`POST /channels/:id/attachments/uploads`, then a `PUT` per part at the offset the server
 * has got to). A part the connection drops is sent again, from where the server says it got to, a few times over
 * with a growing pause; the server's refusals end it. The last part's answer is the attachment.
 */
function uploadInParts(channelId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  let cancelled = false
  let xhr: XMLHttpRequest | null = null
  const auth = (): Record<string, string> => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {} }
  const refused = async (r: Response) => { let msg = `Upload failed (${r.status})`; try { msg = (await r.json()).error ?? msg } catch { /* keep */ } return new Refused(msg, r.status) }
  /** One part, with its progress; resolves with the server's answer, rejects when the connection drops it. */
  const send = (id: string, at: number, part: Blob) => new Promise<{ status: number; body: PartsState | null; text: string }>((resolve, reject) => {
    const x = xhr = new XMLHttpRequest()
    x.open('PUT', `/api/attachments/uploads/${id}?offset=${at}`)
    for (const [k, v] of Object.entries(auth())) x.setRequestHeader(k, v)
    x.setRequestHeader('Content-Type', 'application/octet-stream')
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(1, (at + e.loaded) / file.size)) }
    x.onload = () => { let body: PartsState | null = null; try { body = JSON.parse(x.responseText) } catch { /* not JSON */ } resolve({ status: x.status, body, text: x.responseText }) }
    x.onerror = () => reject(new Error(CUT_OFF))
    x.onabort = () => reject(new Error(cancelled ? 'Upload cancelled' : CUT_OFF))
    x.send(part)
  })
  const promise = (async (): Promise<Attachment> => {
    const r = await fetch(`/api/channels/${channelId}/attachments/uploads`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, content_type: file.type }) })
    if (!r.ok) throw await refused(r)
    const start = await r.json() as PartsState
    let received = start.received, tries = 0
    for (;;) {
      if (cancelled) throw new Error('Upload cancelled')
      try {
        const a = await send(start.id, received, file.slice(received, Math.min(file.size, received + start.part_bytes)))
        if (a.status === 201 && a.body?.attachment) { onProgress(1); return a.body.attachment }
        if ((a.status === 200 || a.status === 409) && a.body) { received = a.body.received; tries = 0; continue }
        let msg = `Upload failed (${a.status})`; try { msg = JSON.parse(a.text).error ?? msg } catch { /* keep */ }
        // A gateway that gave up or is restarting is tried again; anything else the server said ends it.
        if (a.status >= 500) throw new Error(msg)
        throw new Refused(msg, a.status)
      } catch (e) {
        if (cancelled || e instanceof Refused) throw e
        if (++tries > 5) throw e
        await new Promise((res) => setTimeout(res, Math.min(15000, 1000 * 2 ** tries)))
        if (cancelled) throw new Error('Upload cancelled')
        // Where the server got to: the part may have landed though its answer did not.
        const s = await fetch(`/api/attachments/uploads/${start.id}`, { headers: auth() }).then((x) => (x.ok ? x.json() as Promise<PartsState> : null)).catch(() => null)
        if (s) received = s.received
      }
    }
  })()
  return { promise, abort: () => { cancelled = true; xhr?.abort() } }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export const isImage = (ct: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(ct)
export const isVideo = (ct: string) => /^video\/(mp4|webm|quicktime)$/.test(ct)
export const isAudio = (ct: string) => /^audio\//.test(ct)

export const MAX_PROFILE_IMAGE_BYTES = 8 * 1024 * 1024

/** GIF, APNG and animated WebP are uploaded untouched so they keep animating. */
export async function isAnimatedImage(file: File): Promise<boolean> {
  if (!/^image\/(gif|png|apng|webp)$/.test(file.type)) return false
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer())
  const find = (needle: string, from = 0, to = head.length) => {
    const n = Array.from(needle, (c) => c.charCodeAt(0))
    outer: for (let i = from; i <= to - n.length; i++) { for (let j = 0; j < n.length; j++) if (head[i + j] !== n[j]) continue outer; return i }
    return -1
  }
  if (file.type === 'image/gif') {
    let frames = 0
    for (let i = 0; i < head.length - 2; i++) if (head[i] === 0x21 && head[i + 1] === 0xf9 && head[i + 2] === 0x04 && ++frames >= 2) return true
    return false
  }
  if (file.type === 'image/webp') return find('ANIM', 12) >= 0
  const idat = find('IDAT'); return find('acTL', 0, idat < 0 ? head.length : idat) >= 0
}

/** Shrink a static image to fit; animated ones pass through as-is. */
export async function prepareImage(file: File, maxW: number, maxH: number): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image')
  if (file.size > MAX_PROFILE_IMAGE_BYTES) throw new Error('Image must be under 8 MB')
  if (await isAnimatedImage(file)) return file
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Could not read image') })
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close()
  const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.9))
  if (!blob) throw new Error('Could not encode image')
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg'), { type })
}

/** Upload an avatar, banner or server icon; returns its served URL. */
export async function uploadImage(kind: 'avatar' | 'banner' | 'icon', file: File): Promise<UploadedImage> {
  const form = new FormData()
  form.append('file', file, file.name)
  const token = getToken()
  const res = await fetch(`/api/images?kind=${kind}`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) { let msg = `Upload failed (${res.status})`; try { msg = (await res.json()).error ?? msg } catch { /* keep */ } throw new Error(msg) }
  return res.json()
}

/** Multipart POST with extra text fields (custom emoji / sticker creation). */
export async function postMultipart<T>(path: string, file: File, fields: Record<string, string>): Promise<T> {
  const form = new FormData()
  Object.entries(fields).forEach(([k, v]) => form.append(k, v))
  form.append('file', file, file.name)
  const token = getToken()
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) { let msg = `Upload failed (${res.status})`; try { msg = (await res.json()).error ?? msg } catch { /* keep */ } throw new Error(msg) }
  return res.json()
}

/** Upload a recorded voice message with its waveform and length (fields go first so the server reads them before the file). */
export function uploadVoice(channelId: string, blob: Blob, waveform: Uint8Array, durationMs: number): Promise<Attachment> {
  const form = new FormData()
  form.append('duration_ms', String(Math.round(durationMs)))
  form.append('waveform', btoa(String.fromCharCode(...waveform)))
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
  form.append('file', blob, `voice-message.${ext}`)
  const token = getToken()
  return fetch(`/api/channels/${channelId}/attachments`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }).then(async (r) => {
    const j = await r.json().catch(() => null)
    if (!r.ok) throw new Error(j?.error ?? `Upload failed (${r.status})`)
    return j as Attachment
  })
}
