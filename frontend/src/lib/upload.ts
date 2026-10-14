import { getToken } from './api'
import type { Attachment } from './types'

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
