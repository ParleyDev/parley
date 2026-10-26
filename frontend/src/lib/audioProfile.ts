import type { Channel } from './types'

/**
 * Per-channel audio profile (set in Channel Settings → Overview for voice, stage and studio channels).
 *
 *   voice  Speech: the user's echo cancellation / noise suppression / auto gain, mono Opus, DTX allowed.
 *   music  High fidelity: no processing, stereo 48 kHz Opus, no DTX, high bitrate (up to 510 kbps).
 *   lowLatency  10 ms Opus frames (libwebrtc's smallest; default is 20 ms) and the smallest jitter buffer the
 *               browser allows, trading robustness on lossy networks for ~20-60 ms less mouth-to-ear delay.
 *
 * Each client advertises the profile in the session descriptions it sends; Opus encoders follow what the
 * receiver advertises, so everyone in the channel sends and receives the same quality.
 */
export type AudioMode = 'voice' | 'music'
export interface AudioProfile { mode: AudioMode; bitrate: number; lowLatency: boolean }

export const DEFAULT_BITRATE: Record<AudioMode, number> = { voice: 64, music: 256 }
export const MIN_BITRATE = 8
export const MAX_BITRATE = 510

export function profileOf(ch: Pick<Channel, 'audio_mode' | 'audio_bitrate' | 'audio_low_latency'> | null | undefined): AudioProfile {
  const mode: AudioMode = ch?.audio_mode === 'music' ? 'music' : 'voice'
  const b = ch?.audio_bitrate ?? 0
  const bitrate = b >= MIN_BITRATE && b <= MAX_BITRATE ? b : DEFAULT_BITRATE[mode]
  return { mode, bitrate, lowLatency: !!ch?.audio_low_latency }
}

export const sameProfile = (a: AudioProfile, b: AudioProfile) => a.mode === b.mode && a.bitrate === b.bitrate && a.lowLatency === b.lowLatency

/** Capture constraints: high fidelity bypasses all voice processing and asks for 48 kHz stereo with minimal latency. */
export function captureConstraints(p: AudioProfile, user: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }): MediaTrackConstraints {
  const c: MediaTrackConstraints & { latency?: ConstrainDouble } = p.mode === 'music'
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } }
    : { echoCancellation: user.echoCancellation, noiseSuppression: user.noiseSuppression, autoGainControl: user.autoGainControl }
  if (p.lowLatency) c.latency = { ideal: 0.01 }
  return c
}

/**
 * Rewrite the Opus parameters of an SDP we are about to send, so the other side's encoder uses this profile:
 * bitrate, stereo, DTX, in-band FEC and (low latency) 10 ms frames via a=ptime / minptime.
 */
export function tuneOpusSdp(sdp: string, p: AudioProfile): string {
  const lines = sdp.split('\r\n')
  const rtpmap = lines.map((l) => /^a=rtpmap:(\d+) opus\/48000/i.exec(l)).find(Boolean)
  if (!rtpmap) return sdp
  const pt = rtpmap[1]
  const params: Record<string, string> = {}
  let fmtpIdx = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `))
  if (fmtpIdx >= 0) for (const kv of lines[fmtpIdx].slice(`a=fmtp:${pt} `.length).split(';')) { const [k, v] = kv.split('='); if (k?.trim()) params[k.trim()] = (v ?? '').trim() }
  params.minptime = '10'
  params.useinbandfec = '1'
  params.maxaveragebitrate = String(p.bitrate * 1000)
  params.maxplaybackrate = '48000'
  params['sprop-maxcapturerate'] = '48000'
  if (p.mode === 'music') { params.stereo = '1'; params['sprop-stereo'] = '1'; params.usedtx = '0' }
  else { params.stereo = '0'; params['sprop-stereo'] = '0' }
  const fmtp = `a=fmtp:${pt} ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';')}`
  if (fmtpIdx >= 0) lines[fmtpIdx] = fmtp
  else { fmtpIdx = lines.indexOf(rtpmap[0]) + 1; lines.splice(fmtpIdx, 0, fmtp) }
  // Frame size lives in the audio m-section's a=ptime (libwebrtc maps it onto the Opus encoder).
  const start = lines.slice(0, fmtpIdx).map((l, i) => (l.startsWith('m=audio') ? i : -1)).filter((i) => i >= 0).pop() ?? -1
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && l.startsWith('m='))
    if (end < 0) end = lines.length
    for (let i = end - 1; i > start; i--) if (/^a=(max)?ptime:/.test(lines[i])) { lines.splice(i, 1); if (i < fmtpIdx) fmtpIdx-- }
    lines.splice(fmtpIdx + 1, 0, `a=ptime:${p.lowLatency ? 10 : 20}`)
  }
  return lines.join('\r\n')
}

/** Outgoing audio: cap at the profile bitrate and ask the network stack to prioritise it over video. */
export function tuneAudioSender(sender: RTCRtpSender, p: AudioProfile) {
  if (sender.track?.kind !== 'audio' && sender.track !== null) return
  try {
    const params = sender.getParameters()
    if (!params.encodings?.length) return
    const enc = params.encodings[0] as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }
    enc.maxBitrate = p.bitrate * 1000
    enc.priority = 'high'
    enc.networkPriority = 'high'
    sender.setParameters(params).catch(() => {})
  } catch { /* not negotiated yet */ }
}

/** Incoming audio: a 0 ms jitter-buffer target asks for the smallest buffer the network allows; null restores the default. */
export function tuneAudioReceiver(receiver: RTCRtpReceiver | undefined, p: AudioProfile) {
  if (!receiver) return
  const r = receiver as unknown as Record<string, unknown>
  try {
    if ('jitterBufferTarget' in r) r.jitterBufferTarget = p.lowLatency ? 0 : null
    else if ('playoutDelayHint' in r) r.playoutDelayHint = p.lowLatency ? 0 : null
  } catch { /* unsupported */ }
}

export interface AudioStat {
  userId: string
  /** e.g. "opus 48 kHz stereo" */
  codec: string
  inKbps: number | null
  outKbps: number | null
  /** Outgoing frame size from the packet rate (10 or 20 ms), when sending. */
  frameMs: number | null
  jitterBufferMs: number | null
  rttMs: number | null
  lossPct: number | null
  /** Video on this connection (camera or screen), when any is flowing. */
  videoIn?: VideoStat | null
  videoOut?: VideoStat | null
}
export interface VideoStat { width: number; height: number; fps: number | null; kbps: number | null }

type Snap = { t: number; inBytes: number; outBytes: number; outPackets: number; jbDelay: number; jbCount: number; vIn: number; vOut: number }
// Last sample and result per connection: rates need two samples, and callers polling close together (stats popover,
// tests) reuse the last result instead of measuring over a sliver of time.
const snaps = new WeakMap<object, { snap: Snap; result: AudioStat | null }>()

/** Live audio numbers for one connection (mesh peer) or one receiver/sender pair (SFU), from two getStats samples. */
export async function measure(userId: string, source: { pc?: RTCPeerConnection; receiver?: RTCRtpReceiver; sender?: RTCRtpSender }): Promise<AudioStat> {
  const reports: RTCStatsReport[] = []
  if (source.pc) reports.push(await source.pc.getStats())
  else {
    if (source.receiver) reports.push(await source.receiver.getStats())
    if (source.sender) reports.push(await source.sender.getStats())
  }
  const all = new Map<string, Record<string, unknown>>()
  for (const r of reports) r.forEach((v: Record<string, unknown>, k: string) => all.set(k, v))
  let inbound: Record<string, unknown> | undefined, outbound: Record<string, unknown> | undefined, pair: Record<string, unknown> | undefined
  // Video: the busiest stream each way (camera or screen).
  let vIn: Record<string, unknown> | undefined, vOut: Record<string, unknown> | undefined
  const bytes = (r?: Record<string, unknown>, k = 'bytesReceived') => Number(r?.[k] ?? 0)
  all.forEach((v) => {
    if (v.type === 'inbound-rtp' && v.kind === 'video' && Number(v.frameWidth ?? 0) > 0 && bytes(v) >= bytes(vIn)) vIn = v
    if (v.type === 'outbound-rtp' && v.kind === 'video' && Number(v.frameWidth ?? 0) > 0 && bytes(v, 'bytesSent') >= bytes(vOut, 'bytesSent')) vOut = v
    if (v.type === 'inbound-rtp' && v.kind === 'audio') inbound = v
    if (v.type === 'outbound-rtp' && v.kind === 'audio') outbound = v
    if (v.type === 'candidate-pair' && (v.nominated || v.selected) && v.state === 'succeeded') pair = v
  })
  // The sending codec's fmtp is the far side's description (what they asked us for), so it shows the real channel
  // layout; the receiving codec's fmtp is our own unmodified local description.
  const codecRep: Record<string, unknown> | undefined = (outbound?.codecId ? all.get(String(outbound.codecId)) : undefined) ?? (inbound?.codecId ? all.get(String(inbound.codecId)) : undefined)
  const codec = codecRep ? `${String(codecRep.mimeType ?? '').replace(/^audio\//, '').toLowerCase()} ${Math.round(Number(codecRep.clockRate ?? 48000) / 1000)} kHz ${/stereo=1/.test(String(codecRep.sdpFmtpLine ?? '')) ? 'stereo' : 'mono'}` : '—'
  const now: Snap = {
    t: performance.now(),
    inBytes: Number(inbound?.bytesReceived ?? 0), outBytes: Number(outbound?.bytesSent ?? 0), outPackets: Number(outbound?.packetsSent ?? 0),
    jbDelay: Number(inbound?.jitterBufferDelay ?? 0), jbCount: Number(inbound?.jitterBufferEmittedCount ?? 0),
    vIn: bytes(vIn), vOut: bytes(vOut, 'bytesSent'),
  }
  const key = (source.pc ?? source.receiver ?? source.sender) as object
  const last = snaps.get(key)
  if (last?.result && (now.t - last.snap.t) < 500) return last.result
  const prev = last?.snap
  const dt = prev ? (now.t - prev.t) / 1000 : 0
  const rate = (a: number, b: number) => (prev && dt > 0.2 ? Math.max(0, (a - b) * 8 / 1000 / dt) : null)
  const packetsPerSec = prev && dt > 0.2 ? (now.outPackets - prev.outPackets) / dt : 0
  const jb = prev && now.jbCount > prev.jbCount ? ((now.jbDelay - prev.jbDelay) / (now.jbCount - prev.jbCount)) * 1000 : (now.jbCount ? (now.jbDelay / now.jbCount) * 1000 : null)
  const lost = Number(inbound?.packetsLost ?? 0), got = Number(inbound?.packetsReceived ?? 0)
  const rtt = pair?.currentRoundTripTime ?? (all.get(String(outbound?.remoteId ?? ''))?.roundTripTime)
  const result: AudioStat = {
    userId, codec,
    inKbps: inbound ? rate(now.inBytes, prev?.inBytes ?? 0) : null,
    outKbps: outbound ? rate(now.outBytes, prev?.outBytes ?? 0) : null,
    frameMs: packetsPerSec > 20 ? Math.round(1000 / packetsPerSec / 10) * 10 || 10 : null,
    jitterBufferMs: jb == null ? null : Math.round(jb),
    rttMs: rtt == null ? null : Math.round(Number(rtt) * 1000),
    lossPct: got + lost > 0 ? Math.round((lost / (got + lost)) * 1000) / 10 : null,
    videoIn: vIn ? { width: Number(vIn.frameWidth), height: Number(vIn.frameHeight), fps: vIn.framesPerSecond == null ? null : Math.round(Number(vIn.framesPerSecond)), kbps: (() => { const r = rate(now.vIn, prev?.vIn ?? 0); return r == null ? null : Math.round(r) })() } : null,
    videoOut: vOut ? { width: Number(vOut.frameWidth), height: Number(vOut.frameHeight), fps: vOut.framesPerSecond == null ? null : Math.round(Number(vOut.framesPerSecond)), kbps: (() => { const r = rate(now.vOut, prev?.vOut ?? 0); return r == null ? null : Math.round(r) })() } : null,
  }
  snaps.set(key, { snap: now, result: prev ? result : null })
  return result
}

/** Rough connection quality from round trip and loss: what the tile's signal icon shows. */
export function qualityOf(st: Pick<AudioStat, 'rttMs' | 'lossPct'>): 'good' | 'ok' | 'bad' | null {
  if (st.rttMs == null && st.lossPct == null) return null
  const rtt = st.rttMs ?? 0, loss = st.lossPct ?? 0
  return loss > 5 || rtt > 400 ? 'bad' : loss > 1 || rtt > 200 ? 'ok' : 'good'
}
