import { api, getToken } from './api'
import { clickAt } from './multitrack'
import { engine, newId, useDaw } from './daw'
import { serverNow, syncClock } from './clock'
import { useStore } from '../store'
import type { StudioConfig, StudioSession, StudioTrack } from './types'
import { voice } from './voice'
import { pcm24 } from './wav'
import { noteTake, recoverTakes, sendTake, takeRoom, takeStore, useTakes, type TakeMeta } from './takestore'
import { analyserReading, latchClip, studioModule, type Reading } from './meters'
import { t } from '../lib/i18n'

/** Console defaults for a studio that has never been configured (the server's defaults). */
export const DEFAULT_STUDIO: StudioConfig = { bpm: 120, beats: 4, click: false, count_in: 0, disarmed: [] }

/** A take is at most this long (the server's limit too). */
const MAX_TAKE_SECS = 30 * 60
/** Below this much room on the device a take is not started: it could not be kept safe. */
const MIN_ROOM = 64 * 1024 * 1024

/** Where takes of this page are silent because the browser did not run the recorder (frames into the take). Tests read it. */
const drops: { take: string; at: number; frames: number }[] = []
if (typeof window !== 'undefined') (window as unknown as { __parleyStudioDrops?: unknown }).__parleyStudioDrops = drops
/** Safari keeps one capture of a device: a second one with other settings would change the call's. */
const oneCapture = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent)
const clean = (id?: string): MediaStreamConstraints => ({ audio: { ...(id ? { deviceId: { exact: id } } : {}), channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })

/**
 * Recording Studio client: while a take runs, every band member records their armed tracks, each from the input it is
 * set to (their microphone, or an input device by name and one or both of its channels: a two-input interface makes
 * two separate takes). A member with no track of their own yet records their microphone as one take, which makes
 * them one. It follows the studio's state rather than single events, so arming a track during a take, or joining the
 * band late, punches in a new clip, and disarming punches out.
 *
 * A take is the input's samples as they are: an AudioWorklet in the engine's context hands them over uncompressed,
 * they are kept on this device as 24-bit PCM (lib/takestore.ts) and sent to the server from there. The take is placed
 * by the audio clock: the context time of its first sample against the context time of the take's downbeat, the one
 * the backing and the click play from, so what was played lines up with what was heard. Its length is its samples.
 * The microphone is taken before the call's voice processing where it can be (a take through echo cancellation or
 * noise suppression says so); muting yourself silences your microphone's take too. A browser that cannot capture
 * this way records with MediaRecorder instead, and that take is marked compressed.
 */
type Opened = { stream: MediaStream | null; node?: AudioNode; processed: boolean; name: string; gated: boolean; close: () => void }
type Input = { node: AudioNode; channels: 1 | 2; stream: MediaStream | null; processed: boolean; name: string; release: () => void }
type Rec = { trackId: string; sessionId: string; stop: () => Promise<void>; flush?: () => void }

class StudioRecorder {
  /** What is recording, by track ('' for a member's take with no track of their own yet). */
  private recs = new Map<string, Rec>()
  private starting = new Set<string>()
  /** Tracks we could not record in a take (no mic, refused, no such input): not retried on every store change. */
  private failed = new Set<string>()
  /** The take announced by STUDIO_SESSION, live until its stop, even before the sessions list has caught up. */
  private known: { channel: string; session: string } | null = null
  /** Inputs open now, shared by the tracks on them: the microphone (''), and input devices by name. */
  private inputs = new Map<string, { open: Promise<Opened>; users: number }>()
  /** My armed tracks' inputs, held open while I am in the studio: their level shows before the take. */
  private meters = new Map<string, { sig: string; input: Input; an: AnalyserNode }>()
  private metering = false
  private meterAgain = false

  get recording() { return this.recs.size > 0 }
  /** The take being captured on a track of mine, as peaks every 20 ms from `from` ms after the take's start. */
  private waves = new Map<string, { from: number; peaks: number[] }>()
  wave(key: string) { return this.waves.get(key) }

  constructor() {
    if (typeof window === 'undefined') return
    let prev = useStore.getState()
    if (prev.user) void recoverTakes(prev.user.id)
    useStore.subscribe((s) => {
      // Signed in: send what an earlier page left behind.
      if (s.user && s.user.id !== prev.user?.id) void recoverTakes(s.user.id)
      if (s.studio === prev.studio && s.voiceStates === prev.voiceStates && s.channels === prev.channels && s.myVoiceChannelId === prev.myVoiceChannelId && s.voiceConnecting === prev.voiceConnecting && s.voiceSettings === prev.voiceSettings) { prev = s; return }
      prev = s
      this.sync()
    })
    // Arming, disarming or re-pointing a track during a take punches in or out.
    useDaw.subscribe((s, p) => { if (s.lanes !== p.lanes || s.project?.id !== p.project?.id) this.sync() })
    // The page is going: what has been captured goes to the device's store now, to be sent when the app is next open.
    window.addEventListener('pagehide', () => this.recs.forEach((r) => r.flush?.()))
  }

  onSession(d: { channel_id: string; action: 'start' | 'stop'; session_id: string; started_at?: string; bpm?: number; beats?: number; click?: boolean; count_in_ms?: number; solo?: boolean; started_by?: string; project_id?: string | null }) {
    if (d.action === 'stop') { if (this.known?.session === d.session_id) this.known = null; void this.stopAll(d.session_id); metronome.stop(d.session_id); return }
    this.known = { channel: d.channel_id, session: d.session_id }
    // The sessions list is still loading: act on the event itself.
    const start = d.started_at ? Date.parse(d.started_at) : serverNow()
    // A take recorded alone is only its starter's.
    if (d.solo && d.started_by !== useStore.getState().user?.id) return
    // Over a project the project's grid clicks along with the backing (lib/daw); this plays the count-in.
    if (useStore.getState().myVoiceChannelId === d.channel_id && this.inBand(d.channel_id)) metronome.run(d.session_id, start, d.bpm ?? 120, d.beats ?? 4, !!d.click && !d.project_id, d.count_in_ms ?? 0)
    for (const key of this.wanted(d.channel_id)) void this.start(key, d.session_id, start)
  }

  private inBand(channelId: string) {
    const s = useStore.getState()
    const mine = s.user ? s.voiceStates[s.user.id] : undefined
    return !!mine && mine.channel_id === channelId && !mine.suppress
  }

  /** What I record in this project's voice room now: my armed tracks, or one take of mine if I have no track yet. */
  private wanted(channelId: string): string[] {
    const s = useStore.getState()
    const me = s.user?.id
    const ch = s.channels[channelId]
    if (!me || s.myVoiceChannelId !== channelId || !this.inBand(channelId) || ch?.kind !== 'project') return []
    const { project, lanes } = useDaw.getState()
    const mine = project && project.id === ch.studio?.project_id ? Object.values(lanes).filter((l) => l.kind === 'audio' && l.user_id === me) : []
    if (mine.length) return mine.filter((l) => l.armed).map((l) => l.id)
    return (ch.studio?.disarmed ?? []).includes(me) ? [] : ['']
  }

  /** Bring recording and the click in line with the studio: the take running, my role, my armed tracks. */
  private sync() {
    const s = useStore.getState()
    // The call is reconnecting: what is recording keeps recording, and things are looked at again once it is back.
    if (s.voiceConnecting && this.recs.size) return
    const ch = s.myVoiceChannelId
    const list = ch ? s.studio[ch] : undefined
    const found: StudioSession | undefined = list?.find((x) => !x.ended_at)
    const live = found && (!found.solo || found.started_by === s.user?.id) ? found : undefined
    if (this.known && (this.known.channel !== ch || list?.some((x) => x.id === this.known!.session && x.ended_at))) this.known = null
    const liveId = live?.id ?? this.known?.session ?? null
    if (live && ch && this.inBand(ch)) metronome.run(live.id, Date.parse(live.started_at), live.bpm, live.beats, live.click && !live.project_id, live.count_in_ms)
    else if (!liveId || !ch || !this.inBand(ch)) metronome.stop()
    const want = new Set(liveId && ch ? this.wanted(ch) : [])
    for (const [key, r] of this.recs) if (!want.has(key) || r.sessionId !== liveId) void this.stop(key)
    if (live) for (const key of want) if (!this.recs.has(key) && !this.failed.has(`${live.id}:${key}`)) void this.start(key, live.id, Date.parse(live.started_at))
    void this.meter()
  }

  // ---- inputs ----

  /** Tracks on the same input share one capture of it (opened once, even when they start together). */
  private hold(id: string, open: () => Promise<Opened>) {
    const have = this.inputs.get(id)
    if (have) { have.users++; return have.open }
    const p = open()
    p.catch(() => { if (this.inputs.get(id)?.open === p) this.inputs.delete(id) })
    this.inputs.set(id, { open: p, users: 1 })
    return p
  }
  private letGo(id: string) {
    const h = this.inputs.get(id)
    if (h && --h.users <= 0) { this.inputs.delete(id); void h.open.then((o) => o.close(), () => {}) }
  }

  /**
   * My microphone for a take. As the call has it when the call leaves the sound alone (and muting there mutes here);
   * otherwise the same device opened again with nothing done to the sound, muted along with the call. Only when
   * that cannot be had is it the call's processed sound, and the take says so.
   */
  private async openMic(): Promise<Opened> {
    // For tests: a node in the engine's own graph as the microphone, so what arrives is known to the sample.
    const test = (window as unknown as { __parleyStudioInput?: (ctx: AudioContext) => AudioNode | null }).__parleyStudioInput?.(engine.audio())
    if (test) return { stream: null, node: test, processed: false, name: 'test', gated: false, close: () => {} }
    const call = (): Opened => {
      const stream = voice.getRecordingStream()
      if (!stream || !stream.getAudioTracks().length) throw new Error(t('Recording started, but your microphone is not available'))
      return { stream, processed: voice.micProcessed, name: t('Call microphone'), gated: false, close: () => voice.releaseRecordingStream() }
    }
    if (!voice.micProcessed || oneCapture) return call()
    try {
      const stream = await navigator.mediaDevices.getUserMedia(clean(voice.inputDeviceId))
      return { stream, processed: false, name: stream.getAudioTracks()[0]?.label || t('Microphone'), gated: true, close: () => stream.getTracks().forEach((tr) => tr.stop()) }
    } catch { return call() }
  }

  private async openDevice(device: string): Promise<Opened> {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    const id = devices.find((d) => d.kind === 'audioinput' && d.label === device)?.deviceId
    if (device && !id) throw new Error(t('The input "{name}" is not on this device', { name: device }))
    const stream = await navigator.mediaDevices.getUserMedia(clean(id))
    return { stream, processed: false, name: device || stream.getAudioTracks()[0]?.label || t('Microphone'), gated: false, close: () => stream.getTracks().forEach((tr) => tr.stop()) }
  }

  /** The audio for a track, in the engine's context: its input device and channel(s), or my microphone. */
  private async source(key: string): Promise<Input> {
    const input = key ? useDaw.getState().lanes[key]?.input : null
    const device = input?.device ?? '', channel = input?.channel ?? 'mono'
    const id = !device && channel === 'mono' ? '' : `dev:${device}`
    const o = await this.hold(id, () => (id ? this.openDevice(device) : this.openMic()))
    try {
      // The engine's context: already running (a context made here may be left suspended outside a click).
      const ctx = engine.audio()
      ctx.resume().catch(() => {})
      const src = o.node ?? ctx.createMediaStreamSource(o.stream!)
      const head = ctx.createGain()
      // One channel of it, both as stereo, or (where it is read) both mixed to mono.
      const split = channel === '1' || channel === '2' ? ctx.createChannelSplitter(2) : null
      if (split) { src.connect(split); split.connect(head, channel === '1' ? 0 : 1) } else src.connect(head)
      const gate = o.gated ? setInterval(() => head.gain.setTargetAtTime(voice.recordingSilenced() ? 0 : 1, ctx.currentTime, 0.015), 50) : null
      if (o.gated) head.gain.value = voice.recordingSilenced() ? 0 : 1
      // A track with no input chosen (or a take outside a project) records the microphone as the call has it:
      // in stereo when it is.
      const wide = channel === '1/2' || (!input && o.stream?.getAudioTracks()[0]?.getSettings().channelCount === 2)
      return { node: head, channels: wide ? 2 : 1, stream: o.stream, processed: o.processed, name: o.name, release: () => {
        if (gate) clearInterval(gate)
        try { src.disconnect(split ?? head) } catch { /* already gone */ }
        split?.disconnect(); head.disconnect()
        this.letGo(id)
      } }
    } catch (e) { this.letGo(id); throw e }
  }

  /** Hold the inputs of my armed tracks open while I am in the studio, so their level shows before recording. */
  private async meter() {
    if (this.metering) { this.meterAgain = true; return }
    this.metering = true
    try {
      const s = useStore.getState()
      const ch = s.myVoiceChannelId
      const lanes = useDaw.getState().lanes
      const want = new Map<string, string>()
      if (ch && !s.voiceConnecting) for (const key of this.wanted(ch)) if (key && lanes[key]) want.set(key, [lanes[key].input?.device ?? '', lanes[key].input?.channel ?? 'mono', ch, voice.inputDeviceId, voice.micProcessed].join('|'))
      // The recorder's processor, loaded before the first take needs it.
      if (want.size) studioModule(engine.audio()).catch(() => {})
      for (const [key, m] of this.meters) if (want.get(key) !== m.sig) { this.meters.delete(key); m.input.node.disconnect(m.an); m.input.release() }
      const inputs: Record<string, { name: string; processed: boolean; error?: string }> = {}
      for (const [key, sig] of want) {
        let m = this.meters.get(key)
        if (!m) {
          try {
            const input = await this.source(key)
            const an = engine.audio().createAnalyser(); an.fftSize = 1024
            input.node.connect(an)
            this.meters.set(key, (m = { sig, input, an }))
          } catch (e) { inputs[key] = { name: '', processed: false, error: (e as Error).message }; continue }
        }
        inputs[key] = { name: m.input.name, processed: m.input.processed }
      }
      const had = useTakes.getState().inputs
      if (JSON.stringify(had) !== JSON.stringify(inputs)) useTakes.setState({ inputs })
    } finally {
      this.metering = false
      if (this.meterAgain) { this.meterAgain = false; void this.meter() }
    }
  }

  /** The level arriving at an armed track of mine (null when its input is not open). An input at full scale has clipped. */
  reading(key: string): Reading | null {
    const m = this.meters.get(key)
    if (!m) return null
    const r = analyserReading(m.an)
    if (r.peak >= 0.999) latchClip(key)
    return r
  }

  // ---- latency ----

  /**
   * Measure, on this device, how long it is from the studio playing a sound to that sound arriving at a track's
   * input (or at my microphone): five clicks are played and listened for. It needs the output to reach the input:
   * a loopback cable, or headphones held to the microphone. The figure is kept for that input and output (see
   * engine.latencyMs) and takes are placed by it from then on.
   */
  async calibrate(key = ''): Promise<number> {
    const ctx = engine.audio()
    await ctx.resume().catch(() => {})
    await studioModule(ctx)
    const input = await this.source(key)
    const node = new AudioWorkletNode(ctx, 'parley-take-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { channels: 1 } })
    const sink = ctx.createGain(); sink.gain.value = 0
    input.node.connect(node); node.connect(sink).connect(ctx.destination)
    try {
      const rate = ctx.sampleRate, clicks = 5, gap = 0.6, quiet = 0.3
      const first = Math.round((ctx.currentTime + 0.2 + quiet) * rate)
      const at = Array.from({ length: clicks }, (_, k) => first + Math.round(k * gap * rate))
      const from = first - Math.round(quiet * rate), len = Math.round((quiet + clicks * gap) * rate)
      const heard = new Float32Array(len)
      const done = new Promise<void>((res) => {
        const give = setTimeout(res, (0.2 + quiet + clicks * gap + 1.5) * 1000)
        node.port.onmessage = (e: MessageEvent<{ end?: boolean; frame: number; samples: Float32Array; frames: number }>) => {
          if (e.data.end) return
          const o = e.data.frame - from
          for (let i = Math.max(0, -o); i < e.data.frames && o + i < len; i++) heard[o + i] = e.data.samples[i]
          if (o + e.data.frames >= len) { clearTimeout(give); res() }
        }
      })
      for (const f of at) engine.ping(f / rate)
      await done
      // The room before the first click: a click counts when it stands well clear of that.
      let floor = 0
      const q = Math.round(quiet * rate)
      for (let i = 0; i < q; i++) floor += heard[i] * heard[i]
      floor = Math.sqrt(floor / q)
      const found: number[] = []
      for (const f of at) {
        const a = f - from, b = Math.min(len, a + Math.round(0.5 * rate))
        let peak = 0
        for (let i = a; i < b; i++) { const v = Math.abs(heard[i]); if (v > peak) peak = v }
        if (peak < 0.002 || peak < floor * 8) continue
        // Where the click begins, not where the room is loudest.
        for (let i = a; i < b; i++) if (Math.abs(heard[i]) >= peak / 2) { found.push(((i - a) * 1000) / rate); break }
      }
      found.sort((x, y) => x - y)
      if (found.length < 3 || found[found.length - 1] - found[0] > 3) throw new Error(t('Could not hear the test clicks clearly. Connect the output to the input with a cable, or hold your headphones to the microphone, and try again.'))
      const ms = found[found.length >> 1]
      engine.setMeasured(input.stream, ms)
      return ms
    } finally {
      node.port.postMessage('stop')
      try { input.node.disconnect(node) } catch { /* already gone */ }
      node.disconnect(); sink.disconnect(); input.release()
    }
  }
  /** The input a track of mine records (or my microphone), for the latency figures; null when it is not open. */
  inputStream(key: string) { return this.meters.get(key)?.input.stream ?? null }

  // ---- recording ----

  private async start(key: string, sessionId: string, serverStart: number) {
    if (this.recs.has(key) || this.starting.has(key)) return
    this.starting.add(key)
    let input: Input | null = null
    try {
      input = await this.source(key)
      await syncClock()
      let rec: Rec
      try { rec = await this.capture(key, sessionId, serverStart, input) }
      catch (e) {
        if ((e as { keep?: boolean }).keep) throw e
        // No PCM capture in this browser: its own recorder, and the take is marked compressed.
        console.warn('PCM capture unavailable, recording compressed', e)
        rec = await this.compressed(key, sessionId, serverStart, input)
      }
      input = null
      this.recs.set(key, rec)
      this.expose()
      if (this.recs.size === 1) useStore.getState().pushToast(t('Recording: your track is being captured'))
    } catch (e) {
      this.failed.add(`${sessionId}:${key}`)
      input?.release()
      useStore.getState().pushToast((e as Error).message, 'error')
    } finally {
      this.starting.delete(key)
      // Things may have moved on while we were starting (disarmed, take stopped).
      queueMicrotask(() => this.sync())
    }
  }

  /** Record the input's samples as they are, into the device's take store, from where they are sent. */
  private async capture(key: string, sessionId: string, serverStart: number, input: Input): Promise<Rec> {
    const ctx = engine.audio()
    const user = useStore.getState().user?.id ?? ''
    await studioModule(ctx)
    const room = await takeRoom()
    if (room !== null && room < MIN_ROOM) throw Object.assign(new Error(t('Not enough storage left on this device to record a take')), { keep: true })
    const rate = ctx.sampleRate, ch = input.channels
    const node = new AudioWorkletNode(ctx, 'parley-take-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: ch, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { channels: ch } })
    // Pulled by the output, silently.
    const sink = ctx.createGain(); sink.gain.value = 0
    input.node.connect(node); node.connect(sink).connect(ctx.destination)
    const id = newId()
    const down = engine.downbeat(sessionId, serverStart)
    const limit = MAX_TAKE_SECS * rate
    let meta: TakeMeta | null = null
    let frames = 0, next = 0, written = 0, held = 0, full = false, broken = false, lost = 0
    let wave: { from: number; peaks: number[] } | null = null
    let top = 0, seen = 0
    const bin = Math.round(rate / 50) * ch
    let pend: Uint8Array[] = []
    let queue: Promise<unknown> = Promise.resolve()
    let ended = () => {}
    const end = new Promise<void>((res) => { ended = res })
    // Half a second at a time onto the device, then on to the server.
    const flush = () => {
      if (!meta || !held) return
      const data = new Uint8Array(held)
      let o = 0
      for (const p of pend) { data.set(p, o); o += p.length }
      const at = written
      written += held; pend = []; held = 0
      const m = meta = { ...meta, bytes: written, at: Date.now() }
      queue = queue.then(() => takeStore.add(id, at, data)).then(() => takeStore.put(m)).then(() => { noteTake(id, { bytes: m.bytes }); sendTake(id) }).catch(() => {
        if (broken) return
        broken = true
        useStore.getState().pushToast(t('This device could not keep the take: recording stopped'), 'error')
        void this.stop(key)
      })
    }
    node.port.onmessage = (e: MessageEvent<{ end?: boolean; frame: number; samples: Float32Array; frames: number }>) => {
      if (e.data.end) { ended(); return }
      const whole = e.data.samples
      let s = whole.subarray(0, e.data.frames * ch)
      // Every batch goes where its frame says. As a take starts the browser may not run the processor for a moment,
      // or run it twice for the same frames: the take is silent where nothing was handed over, and keeps its time.
      const gap = meta ? e.data.frame - next : 0
      next = e.data.frame + s.length / ch
      if (gap < 0) s = s.subarray(Math.min(s.length, -gap * ch))
      else if (gap > 0) { const pad = new Float32Array(Math.min(gap, Math.max(0, limit - frames)) * ch + s.length); pad.set(s, pad.length - s.length); s = pad; lost += gap; drops.push({ take: id, at: frames, frames: gap }) }
      if (!meta) {
        // From the downbeat to the first sample, on the audio clock; the take begins on a whole millisecond of it.
        const raw = e.data.frame / rate - down
        const ms = Math.ceil(raw * 1000 - 1e-6)
        s = s.subarray(Math.min(s.length / ch, Math.max(0, Math.round((ms / 1000 - raw) * rate))) * ch)
        meta = { id, session: sessionId, user, lane: key, rate, channels: ch, offset_ms: ms, latency_ms: engine.latencyMs(input.stream), processed: input.processed, bytes: 0, ended: false, at: Date.now() }
        noteTake(id, { session: sessionId, lane: key, state: 'recording', processed: input.processed })
        // Its track appears on the server at once: the band sees who is recording.
        this.waves.set(key, (wave = { from: ms, peaks: [] }))
        const m = meta
        queue = queue.then(() => takeStore.put(m)).then(() => sendTake(id)).catch(() => {})
      }
      if (frames + s.length / ch > limit) s = s.subarray(0, Math.max(0, limit - frames) * ch)
      if (s.length) { const b = pcm24(s); pend.push(b); held += b.length; frames += s.length / ch }
      // What it looks like so far, for the timeline.
      if (wave) for (let i = 0; i < s.length; i++) { const v = s[i] < 0 ? -s[i] : s[i]; if (v > top) top = v; if (++seen >= bin) { wave.peaks.push(top); top = 0; seen = 0 } }
      // Read: the buffer goes back to the processor for a later batch.
      node.port.postMessage({ spare: whole }, [whole.buffer])
      if (held >= (rate >> 1) * ch * 3) flush()
      if (frames >= limit && !full) {
        full = true
        useStore.getState().pushToast(t('A take can be {minutes} minutes long: this one is full', { minutes: MAX_TAKE_SECS / 60 }), 'error')
        void this.stop(key)
      }
    }
    const stop = async () => {
      // The samples still in the processor come first.
      node.port.postMessage('stop')
      await Promise.race([end, new Promise((res) => setTimeout(res, 500))])
      try { input.node.disconnect(node) } catch { /* already gone */ }
      node.disconnect(); sink.disconnect(); input.release()
      if (this.waves.get(key) === wave) this.waves.delete(key)
      if (!meta) return
      // Said, not hidden: the take is in time but has holes, and may be worth doing again.
      if (lost) useStore.getState().pushToast(t('The browser dropped {ms} ms of audio during this take (this device was busy): listen before you keep it', { ms: Math.max(1, Math.round((lost * 1000) / rate)) }), 'error')
      flush()
      const m = meta = { ...meta, ended: true, at: Date.now() }
      queue = queue.then(() => takeStore.put(m)).then(() => { noteTake(id, { bytes: m.bytes, state: 'uploading' }); sendTake(id) }).catch(() => {})
      await queue
    }
    return { trackId: id, sessionId, stop, flush }
  }

  /** Record with the browser's own recorder (compressed), streaming 5-second pieces to the server. */
  private async compressed(key: string, sessionId: string, serverStart: number, input: Input): Promise<Rec> {
    const ctx = engine.audio()
    const dest = ctx.createMediaStreamDestination()
    dest.channelCount = input.channels; dest.channelCountMode = 'explicit'
    input.node.connect(dest)
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
    const offset = Math.round(serverNow() - serverStart)
    // Recording over the project: placed earlier by the time from hearing it to the mic capturing what is played.
    const track = await api.post<{ id: string }>(`/studio/sessions/${sessionId}/tracks`, { offset_ms: offset, content_type: mime.split(';')[0] || 'audio/webm', latency_ms: engine.latencyMs(input.stream), processed: input.processed, ...(key ? { lane_id: key } : {}) })
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined)
    const startedAt = Date.now()
    let queue: Promise<void> = Promise.resolve()
    noteTake(track.id, { session: sessionId, lane: key, state: 'recording', compressed: true, processed: input.processed })
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      queue = queue.then(async () => {
        const token = getToken()
        const res = await fetch(`/api/studio/sessions/${sessionId}/tracks/${track.id}/chunks`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: e.data })
        if (!res.ok) throw new Error(`chunk upload failed (${res.status})`)
      }).catch((err) => { useStore.getState().pushToast(t('Recording upload: {message}', { message: (err as Error).message }), 'error') })
    }
    const stopped = new Promise<void>((res) => { rec.onstop = () => res() })
    rec.start(5000)
    const stop = async () => {
      if (rec.state !== 'inactive') { rec.stop(); await stopped }
      try { input.node.disconnect(dest) } catch { /* already gone */ }
      input.release()
      await queue
      try { await api.post(`/studio/sessions/${sessionId}/tracks/${track.id}/finish`, { duration_ms: Date.now() - startedAt }) } catch { /* server keeps what it has */ }
      noteTake(track.id, { state: 'done' })
    }
    return { trackId: track.id, sessionId, stop }
  }

  private async stop(key: string) {
    const r = this.recs.get(key)
    if (!r) return
    this.recs.delete(key)
    this.expose()
    await r.stop().catch(() => {})
  }

  async stopAll(sessionId?: string) { await Promise.all(Array.from(this.recs).filter(([, r]) => !sessionId || r.sessionId === sessionId).map(([key]) => this.stop(key))) }

  private expose() { (window as unknown as { __parleyStudio?: unknown }).__parleyStudio = { recording: this.recs.size > 0, tracks: [...this.recs.keys()], trackId: [...this.recs.values()][0]?.trackId ?? null } }
}

/**
 * The band's click: every band member's client plays it locally, on the engine's audio clock from the take's downbeat
 * (the moment the backing and the recorder time themselves from), straight to the output: it is not part of the
 * mix, so it reaches neither the recordings (they tap the inputs) nor an export. With a count-in it starts that many
 * bars early; with the metronome off it plays only the count-in.
 */
class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null
  private key = ''
  private session: string | null = null
  private ticks = 0
  /** A count-in that has played is not played again. */
  private done = ''

  /** `start`: the take's downbeat, in server time. */
  run(sessionId: string, start: number, bpm: number, beats: number, click: boolean, countInMs: number) {
    if (!click && !countInMs) { this.stop(); return }
    const key = `${sessionId}:${start}:${bpm}:${beats}:${click}:${countInMs}`
    if (key === this.key || key === this.done) return
    this.stop()
    this.key = key; this.session = sessionId
    const ctx = engine.audio()
    ctx.resume().catch(() => {})
    const beat = 60 / bpm
    const countBeats = Math.round(countInMs / 1000 / beat)
    this.expose()
    void syncClock().then(() => {
      if (this.key !== key) return
      const down = engine.downbeat(sessionId, start)
      // First beat still ahead of us (the count-in may already be under way when we hear of the take).
      let n = Math.max(-countBeats, Math.ceil((ctx.currentTime - 0.01 - down) / beat))
      const tick = () => {
        const now = ctx.currentTime
        while (down + n * beat < now + 0.12) {
          if (!click && n >= 0) { this.done = key; this.stop(); return }
          clickAt(ctx, ctx.destination, Math.max(now, down + n * beat), ((n % beats) + beats) % beats === 0, n < 0); this.ticks++
          n++
        }
        this.expose()
      }
      tick()
      if (this.key === key) this.timer = setInterval(tick, 25)
      this.expose()
    })
  }

  /** Stop the click (of that take only, when given). */
  stop(sessionId?: string) {
    if (sessionId && sessionId !== this.session) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null; this.key = ''; this.session = null
    this.expose()
  }

  private expose() { (window as unknown as { __parleyClick?: unknown }).__parleyClick = { running: !!this.key, ticks: this.ticks } }
}

const metronome = new Metronome()

/** What to say of a take's sound beside its name: recorded compressed, or through the call's voice processing. */
export const takeTag = (a?: StudioTrack | null) => (!a || a.kind === 'import' ? '' : !a.bits ? ` · ${t('compressed')}` : a.processed ? ` · ${t('voice processed')}` : '')
export const studio = new StudioRecorder()

/** Arm or disarm a band member (shared by every engineer; during a take it punches them in or out). */
export const setArm = (channelId: string, userId: string, armed: boolean) => api.put(`/channels/${channelId}/studio/arm/${userId}`, { armed })

/** Change the studio's tempo, beats per bar, metronome or count-in bars. */
export const setStudioConfig = (channelId: string, patch: Partial<Omit<StudioConfig, 'disarmed'>>) => api.patch(`/channels/${channelId}/studio/config`, patch)

/** Start a take with the armed band members (the engineer's console and the Record button share this). */
export async function startTake(channelId: string, name = '', positionMs = 0, solo = false) {
  return api.post(`/channels/${channelId}/studio/sessions`, { name, position_ms: Math.round(positionMs), solo })
}
