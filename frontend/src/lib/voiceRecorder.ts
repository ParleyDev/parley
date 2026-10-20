import { useStore } from '../store'

export interface Recording { blob: Blob; waveform: Uint8Array; durationMs: number }

/** Pick a container the browser can record; Safari only does MP4/AAC. */
export function recordingMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  return ''
}

/** Records the microphone (honouring the chosen input device) and exposes live levels for the UI. */
export class VoiceRecorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private startedAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  /** Live level samples (0..1), one per 100 ms, for the recording animation. */
  levels: number[] = []

  async start(onTick: (levels: number[], ms: number) => void): Promise<void> {
    const st = useStore.getState().voiceSettings
    const audio: MediaTrackConstraints = { echoCancellation: st.echoCancellation, noiseSuppression: st.noiseSuppression, autoGainControl: st.autoGainControl }
    if (st.inputDeviceId) audio.deviceId = { exact: st.inputDeviceId }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser)
    const mime = recordingMime()
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined)
    this.chunks = []; this.levels = []
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) }
    this.rec.start(250)
    this.startedAt = Date.now()
    const buf = new Uint8Array(this.analyser.fftSize)
    this.timer = setInterval(() => {
      if (!this.analyser) return
      this.analyser.getByteTimeDomainData(buf)
      let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      this.levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 3))
      onTick(this.levels, Date.now() - this.startedAt)
    }, 100)
  }

  /** Stop and produce the blob plus a 64-bar waveform decoded from the actual recording. */
  async stop(): Promise<Recording> {
    const rec = this.rec; if (!rec) throw new Error('not recording')
    const blob = await new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })); rec.stop() })
    const durationMs = Date.now() - this.startedAt
    this.cleanup()
    let waveform = levelsToBars(this.levels, 64)
    try {
      const ctx = new AudioContext()
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
      waveform = bufferToBars(audio, 64)
      ctx.close().catch(() => {})
      return { blob, waveform, durationMs: Math.round(audio.duration * 1000) || durationMs }
    } catch { return { blob, waveform, durationMs } }
  }

  cancel() { try { this.rec?.stop() } catch { /* ignore */ } this.cleanup() }

  private cleanup() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null
    this.ctx?.close().catch(() => {}); this.ctx = null; this.analyser = null; this.rec = null
  }
}

function levelsToBars(levels: number[], bars: number): Uint8Array {
  const out = new Uint8Array(bars)
  if (!levels.length) return out
  for (let i = 0; i < bars; i++) { const a = Math.floor((i / bars) * levels.length), b = Math.max(a + 1, Math.floor(((i + 1) / bars) * levels.length)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, levels[j]); out[i] = Math.round(m * 255) }
  return out
}

function bufferToBars(buf: AudioBuffer, bars: number): Uint8Array {
  const data = buf.getChannelData(0)
  const out = new Float32Array(bars)
  const per = Math.max(1, Math.floor(data.length / bars))
  for (let i = 0; i < bars; i++) { let sum = 0; const start = i * per; for (let j = 0; j < per && start + j < data.length; j++) sum += data[start + j] * data[start + j]; out[i] = Math.sqrt(sum / per) }
  const peak = Math.max(0.0001, ...out)
  return Uint8Array.from(out, (v) => Math.round(Math.min(1, v / peak) * 255))
}
