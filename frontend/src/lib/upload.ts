import { getToken } from './api'
import type { Attachment, UploadedImage } from './types'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PER_MESSAGE = 10

export interface UploadHandle { promise: Promise<Attachment>; abort: () => void }

/** Upload one file to a channel with progress (XHR, since fetch has no upload progress). */
export function uploadFile(channelId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<Attachment>((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) { reject(new Error('File too large (max 25 MB)')); return }
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
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export const isImage = (ct: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(ct)
export const isVideo = (ct: string) => /^video\/(mp4|webm)$/.test(ct)
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
