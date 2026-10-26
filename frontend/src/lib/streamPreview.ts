import { getToken } from './api'

/** A still of a video track as JPEG (longest side 480px), or null. */
async function snapshot(track: MediaStreamTrack): Promise<Blob | null> {
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track])
  try { await v.play() } catch { return null }
  await new Promise((r) => setTimeout(r, 150))
  const w = v.videoWidth, h = v.videoHeight
  if (!w || !h) { v.srcObject = null; return null }
  const scale = Math.min(1, 480 / Math.max(w, h))
  const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale)
  cv.getContext('2d')?.drawImage(v, 0, 0, cv.width, cv.height)
  v.srcObject = null
  return new Promise((r) => cv.toBlob((b) => r(b), 'image/jpeg', 0.7))
}

let timer: ReturnType<typeof setInterval> | null = null
/** While sharing a screen into `channelId`, upload a still every 20 s for other people's Watch Stream cards. */
export function startPreviews(channelId: string, track: MediaStreamTrack) {
  stopPreviews()
  const send = async () => {
    if (track.readyState !== 'live') { stopPreviews(); return }
    const blob = await snapshot(track)
    if (!blob) return
    try { await fetch(`/api/channels/${channelId}/stream-preview`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${getToken()}` }, body: blob }) } catch { /* next time */ }
  }
  setTimeout(send, 1500)
  timer = setInterval(send, 20_000)
}
export function stopPreviews() { if (timer) clearInterval(timer); timer = null }

/** Object URL of someone's latest stream still (auth needs a fetch, so no plain <img src>), or null. */
export async function fetchPreview(channelId: string, userId: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/channels/${channelId}/stream-preview/${userId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
    return r.ok ? URL.createObjectURL(await r.blob()) : null
  } catch { return null }
}
