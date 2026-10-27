import { useSyncExternalStore } from 'react'
import { getToken } from './api'
import { useStore } from '../store'

/**
 * Live captions (backend routes/captions.rs). Turning them on sets `captions` on your voice state; while anyone in
 * the call has them on, this client records its own speech a few seconds at a time and sends it for transcription.
 * Lines arrive as CALL_CAPTION and show over the call for a few seconds. Never in end-to-end encrypted calls.
 */
export interface CaptionLine { key: number; userId: string; text: string; at: number }
const SHOW_MS = 9000
let lines: CaptionLine[] = []
let n = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function pushCaption(userId: string, text: string) {
  const now = Date.now()
  lines = [...lines.filter((l) => now - l.at < SHOW_MS), { key: ++n, userId, text, at: now }].slice(-4)
  emit()
  setTimeout(() => { const t = Date.now(); const next = lines.filter((l) => t - l.at < SHOW_MS); if (next.length !== lines.length) { lines = next; emit() } }, SHOW_MS + 50)
}
export function clearCaptions() { if (lines.length) { lines = []; emit() } }
export const useCaptionLines = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => lines)

/** Captions can work in this channel: not end-to-end encrypted, and the server has speech-to-text. */
export function captionsAvailable(channelId: string | null): boolean {
  const s = useStore.getState()
  if (!channelId || !s.instance.transcription) return false
  const ch = s.channels[channelId] ?? s.dms[channelId]
  return !!ch && !ch.e2ee
}

const SEGMENT_MS = 4000

/** Records this client's processed mic in short clips while someone in the call wants captions. */
export class CaptionSender {
  private rec: MediaRecorder | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private spoke = false
  private sampler: ReturnType<typeof setInterval> | null = null
  private quietUntil = 0

  private getTrack: () => MediaStreamTrack | null
  constructor(getTrack: () => MediaStreamTrack | null) { this.getTrack = getTrack }

  /** Call often (once a second): starts or stops recording to match the call's state. */
  tick() {
    const s = useStore.getState()
    const me = s.user?.id
    const ch = s.myVoiceChannelId
    const mine = me ? s.voiceStates[me] : undefined
    const wanted = !!ch && captionsAvailable(ch) && Date.now() > this.quietUntil
      && Object.values(s.voiceStates).some((v) => v.channel_id === ch && v.captions)
      && !!mine && !mine.self_mute && !mine.mute && !mine.suppress && !s.selfMute
    if (wanted && !this.rec) this.start()
    else if (!wanted && this.rec) this.stop()
  }

  private start() {
    const track = this.getTrack()
    if (!track || typeof MediaRecorder === 'undefined') return
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    try { this.rec = new MediaRecorder(new MediaStream([track]), type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined) } catch { this.rec = null; return }
    const me = useStore.getState().user?.id
    this.sampler = setInterval(() => { if (me && useStore.getState().speaking[me]) this.spoke = true }, 150)
    this.segment()
  }

  /** One clip: record, stop after SEGMENT_MS, send it if we spoke, go again. */
  private segment() {
    const rec = this.rec
    if (!rec) return
    this.spoke = false
    const parts: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    rec.onstop = () => {
      const spoke = this.spoke
      if (spoke && parts.length) void this.send(new Blob(parts, { type: rec.mimeType || 'audio/webm' }))
      if (this.rec === rec) this.segment()
    }
    try { rec.start() } catch { this.stop(); return }
    this.timer = setTimeout(() => { if (rec.state === 'recording') rec.stop() }, SEGMENT_MS)
  }

  private async send(blob: Blob) {
    const ch = useStore.getState().myVoiceChannelId
    if (!ch) return
    try {
      const r = await fetch(`/api/channels/${ch}/captions`, { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], Authorization: `Bearer ${getToken() ?? ''}` }, body: blob })
      // Nobody wants them after all, or the server can't: back off for a while.
      if (r.status === 204 || r.status === 400) this.quietUntil = Date.now() + 15_000
    } catch { /* offline: next clip */ }
  }

  stop() {
    const rec = this.rec
    this.rec = null
    if (this.timer) clearTimeout(this.timer)
    if (this.sampler) clearInterval(this.sampler)
    this.timer = null; this.sampler = null
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* already */ } }
  }
}
