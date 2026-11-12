import { api, getToken } from './api'
import { engine, newId, sortedLanes, useDaw, type Op } from './daw'
import { integratedLufs } from './fx'
import { encodeWav } from './multitrack'
import { uploadFile } from './upload'
import { download } from './fileActions'
import type { StudioClip, StudioLane, StudioProject, StudioTrack } from './types'

/**
 * Getting songs out of (and into) the studio: the mix as WAV, FLAC or MP3, stems (each track rendered on its own,
 * zipped), the mix posted to a channel, and whole projects as a .parley-project file (a zip of the project and its
 * audio) that another studio can import.
 */
export type Format = 'wav' | 'flac' | 'mp3'

// ---- zip (stored entries; reading also inflates) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true)
    h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true)
    parts.push(new Uint8Array(h.buffer), name, f.data)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const size = central.reduce((n, x) => n + x.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

export async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf), out = new Map<string, Uint8Array>()
  let e = buf.byteLength - 22
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('Not a zip file')
  const n = v.getUint16(e + 10, true)
  let p = v.getUint32(e + 16, true)
  const dec = new TextDecoder()
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file')
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen))
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = new Uint8Array(buf, start, csize)
    if (method === 0) out.set(name, raw.slice())
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()))
    p += 46 + nlen + xlen + clen
  }
  return out
}

// ---- FLAC (fixed predictors, Rice-coded residuals) ----
class Bits {
  buf: number[] = []; private acc = 0; private n = 0
  put(v: number, bits: number) { for (let i = bits - 1; i >= 0; i--) { this.acc = (this.acc << 1) | ((v / Math.pow(2, i)) & 1); if (++this.n === 8) { this.buf.push(this.acc & 0xff); this.acc = 0; this.n = 0 } } }
  signed(v: number, bits: number) { this.put(v < 0 ? v + Math.pow(2, bits) : v, bits) }
  unary(q: number) { for (let i = 0; i < q; i++) this.put(0, 1); this.put(1, 1) }
  align() { while (this.n) this.put(0, 1) }
}
const crc8 = (d: number[]) => { let c = 0; for (const b of d) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff } return c }
const crc16 = (d: number[]) => { let c = 0; for (const b of d) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff } return c }
const utf8Num = (n: number) => { if (n < 0x80) return [n]; if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)]; if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)]; return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)] }

function residual(x: Int32Array, order: number) {
  const r = new Int32Array(x.length - order)
  for (let i = order; i < x.length; i++) {
    r[i - order] = order === 0 ? x[i] : order === 1 ? x[i] - x[i - 1] : order === 2 ? x[i] - 2 * x[i - 1] + x[i - 2] : order === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]
  }
  return r
}
function subframe(w: Bits, x: Int32Array, bps: number) {
  let best = 0, bestSum = Infinity, bestR: Int32Array = x
  for (let o = 0; o <= Math.min(4, x.length - 1); o++) { const r = residual(x, o); let s = 0; for (const v of r) s += Math.abs(v); if (s < bestSum) { bestSum = s; best = o; bestR = r } }
  w.put(0, 1); w.put(0b001000 | best, 6); w.put(0, 1)
  for (let i = 0; i < best; i++) w.signed(x[i], bps)
  const mean = bestR.length ? bestSum / bestR.length : 0
  const k = Math.max(0, Math.min(14, mean > 0 ? Math.floor(Math.log2(mean * Math.LN2)) : 0))
  w.put(0, 2); w.put(0, 4); w.put(k, 4)
  for (const r of bestR) { const u = r >= 0 ? r * 2 : -r * 2 - 1; w.unary(Math.floor(u / Math.pow(2, k))); if (k) w.put(u % Math.pow(2, k), k) }
}
/** 16-bit FLAC of a buffer. */
export function encodeFlac(buf: AudioBuffer): Uint8Array {
  const ch = Math.min(2, buf.numberOfChannels), rate = buf.sampleRate, total = buf.length, block = 4096, bps = 16
  const data = Array.from({ length: ch }, (_, c) => { const f = buf.getChannelData(c), i = new Int32Array(f.length); for (let k = 0; k < f.length; k++) { const s = Math.max(-1, Math.min(1, f[k])); i[k] = Math.round(s < 0 ? s * 32768 : s * 32767) } return i })
  const out: number[] = [0x66, 0x4c, 0x61, 0x43]
  const si = new Bits()
  si.put(1, 1); si.put(0, 7); si.put(34, 24)
  si.put(block, 16); si.put(block, 16); si.put(0, 24); si.put(0, 24)
  si.put(rate, 20); si.put(ch - 1, 3); si.put(bps - 1, 5); si.put(Math.floor(total / 2 ** 32), 4); si.put(total >>> 0, 32)
  for (let i = 0; i < 16; i++) si.put(0, 8)
  out.push(...si.buf)
  for (let f = 0, start = 0; start < total; f++, start += block) {
    const n = Math.min(block, total - start)
    const w = new Bits()
    w.put(0xfff8, 16)
    w.put(n === block ? 0b1100 : 0b0111, 4); w.put(0, 4); w.put(ch === 2 ? 0b0001 : 0, 4); w.put(0b100, 3); w.put(0, 1)
    for (const b of utf8Num(f)) w.put(b, 8)
    if (n !== block) w.put(n - 1, 16)
    w.put(crc8(w.buf), 8)
    for (let c = 0; c < ch; c++) subframe(w, data[c].subarray(start, start + n), bps)
    w.align()
    const c16 = crc16(w.buf)
    w.put(c16, 16)
    for (const b of w.buf) out.push(b)
  }
  return new Uint8Array(out)
}

/** MP3 (192 kbps) of a buffer. */
export async function encodeMp3(buf: AudioBuffer, kbps = 192): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const ch = Math.min(2, buf.numberOfChannels)
  const enc = new Mp3Encoder(ch, buf.sampleRate, kbps)
  const pcm = Array.from({ length: ch }, (_, c) => { const f = buf.getChannelData(c), i = new Int16Array(f.length); for (let k = 0; k < f.length; k++) { const s = Math.max(-1, Math.min(1, f[k])); i[k] = s < 0 ? s * 32768 : s * 32767 } return i })
  const chunks: Uint8Array[] = []
  for (let i = 0; i < buf.length; i += 1152) { const d = enc.encodeBuffer(pcm[0].subarray(i, i + 1152), ch > 1 ? pcm[1].subarray(i, i + 1152) : undefined); if (d.length) chunks.push(d) }
  const last = enc.flush(); if (last.length) chunks.push(last)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

const TYPES: Record<Format, string> = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg' }
export async function encode(buf: AudioBuffer, format: Format): Promise<Uint8Array> {
  return format === 'wav' ? new Uint8Array(encodeWav(buf)) : format === 'flac' ? encodeFlac(buf) : encodeMp3(buf)
}
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project'
const saveBlob = async (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); await download(url, name); setTimeout(() => URL.revokeObjectURL(url), 30_000) }
const expose = (k: string, v: unknown) => { (window as unknown as Record<string, unknown>)[k] = v }

/** Export the mix in a format; its integrated loudness. */
export async function exportMixAs(format: Format): Promise<number | null> {
  const p = useDaw.getState().project
  const buf = await engine.renderBuffer()
  if (!p || !buf) throw new Error('Nothing to export yet')
  const data = await encode(buf, format)
  expose('__parleyDawExport', data.byteLength); expose('__parleyDawFormat', format)
  const lufs = await integratedLufs(buf)
  expose('__parleyDawLufs', lufs)
  await saveBlob(new Blob([data as BlobPart], { type: TYPES[format] }), `${safe(p.name)} - mix.${format}`)
  return lufs
}

/** Every track rendered on its own (with the buses it feeds), as WAVs in a zip. */
export async function exportStems(): Promise<number> {
  const { project, lanes } = useDaw.getState()
  if (!project) return 0
  const files: { name: string; data: Uint8Array }[] = []
  const used = new Set<string>()
  for (const l of sortedLanes(lanes).filter((x) => x.kind !== 'bus')) {
    const buf = await engine.renderBuffer([l.id])
    if (!buf) continue
    let name = safe(l.name), n = 2
    while (used.has(name)) name = `${safe(l.name)} ${n++}`
    used.add(name)
    files.push({ name: `${name}.wav`, data: new Uint8Array(encodeWav(buf)) })
  }
  if (!files.length) throw new Error('Nothing to export yet')
  expose('__parleyDawStems', files.map((f) => f.name))
  await saveBlob(zip(files), `${safe(project.name)} - stems.zip`)
  return files.length
}

/** Post the mix to a text channel, with a message. */
export async function postMix(channelId: string, format: Format, content: string) {
  const p = useDaw.getState().project
  const buf = await engine.renderBuffer()
  if (!p || !buf) throw new Error('Nothing to export yet')
  const data = await encode(buf, format)
  const file = new File([data as BlobPart], `${safe(p.name)}.${format}`, { type: TYPES[format] })
  const att = await uploadFile(channelId, file, () => {}).promise
  await api.post(`/channels/${channelId}/messages`, { content, attachment_ids: [att.id] })
}

type ProjectFile = { format: 'parley-project'; version: 1; project: Partial<StudioProject>; lanes: StudioLane[]; clips: StudioClip[]; audio: { id: string; name: string; content_type: string; duration_ms: number | null; file: string }[] }

/** The project and its audio as a .parley-project file. */
export async function exportProjectFile() {
  const { project, lanes, clips, audio } = useDaw.getState()
  if (!project) return
  const used = new Set<string>()
  for (const c of Object.values(clips)) if (c.audio_id) used.add(c.audio_id)
  for (const l of Object.values(lanes)) { const a = (l.instrument as { audio_id?: string | null } | null)?.audio_id; if (a) used.add(a) }
  const files: { name: string; data: Uint8Array }[] = []
  const list: ProjectFile['audio'] = []
  const token = getToken()
  for (const id of used) {
    const a = audio[id]
    if (!a) continue
    const r = await fetch(a.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!r.ok) continue
    const name = `audio/${id}`
    files.push({ name, data: new Uint8Array(await r.arrayBuffer()) })
    list.push({ id, name: a.name ?? a.display_name, content_type: a.content_type, duration_ms: a.duration_ms, file: name })
  }
  const { name, bpm, beats, master_gain, master_effects, tempo_map, loop_on, loop_start_ms, loop_end_ms, punch_on, markers } = project
  const doc: ProjectFile = { format: 'parley-project', version: 1, project: { name, bpm, beats, master_gain, master_effects, tempo_map, loop_on, loop_start_ms, loop_end_ms, punch_on, markers }, lanes: Object.values(lanes), clips: Object.values(clips), audio: list }
  files.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(doc)) })
  const blob = zip(files)
  expose('__parleyDawProjectFile', blob.size)
  await saveBlob(blob, `${safe(project.name)}.parley-project`)
}

/** Import a .parley-project file into a studio as a new project (opened for everyone). */
export async function importProjectFile(channelId: string, file: File): Promise<StudioProject> {
  const entries = await unzip(await file.arrayBuffer())
  const raw = entries.get('project.json')
  if (!raw) throw new Error('Not a Parley project file')
  const doc = JSON.parse(new TextDecoder().decode(raw)) as ProjectFile
  if (doc.format !== 'parley-project') throw new Error('Not a Parley project file')
  const token = getToken()
  // The audio first: each file imported anew into this studio.
  const audioMap = new Map<string, string>()
  for (const a of doc.audio) {
    const data = entries.get(a.file)
    if (!data) continue
    const r = await fetch(`/api/channels/${channelId}/studio/audio?name=${encodeURIComponent(a.name)}${a.duration_ms ? `&duration_ms=${a.duration_ms}` : ''}`, { method: 'POST', headers: { 'Content-Type': a.content_type || 'audio/webm', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data as BodyInit })
    const t = await r.json().catch(() => null) as StudioTrack | null
    if (!r.ok || !t) throw new Error((t as unknown as { error?: string } | null)?.error ?? `Could not import ${a.name}`)
    audioMap.set(a.id, t.id)
  }
  const project = await api.post<StudioProject>(`/channels/${channelId}/studio/projects`, { name: doc.project.name ?? file.name.replace(/\.parley-project$/, ''), open: false })
  const laneMap = new Map(doc.lanes.map((l) => [l.id, newId()]))
  const mapAuto = (a: StudioLane['automation']) => Object.fromEntries(Object.entries(a ?? {}).map(([k, v]) => [k.startsWith('send:') ? `send:${laneMap.get(k.slice(5)) ?? k.slice(5)}` : k, v]))
  const lane = (l: StudioLane): Op => {
    const inst = l.instrument && 'audio_id' in l.instrument ? { ...l.instrument, audio_id: l.instrument.audio_id ? audioMap.get(l.instrument.audio_id) ?? null : null } : l.instrument
    return { op: 'lane.put', lane: { id: laneMap.get(l.id)!, name: l.name, color: l.color ?? '', position: l.position, gain: l.gain, pan: l.pan, mute: l.mute, solo: l.solo, kind: l.kind, effects: l.effects, automation: mapAuto(l.automation), nudge_ms: l.nudge_ms ?? 0, ...(inst ? { instrument: inst } : {}) } as Partial<StudioLane> & { id: string } }
  }
  // Buses before the tracks that send to them; routing once both exist.
  const ops: Op[] = [
    { op: 'project', bpm: doc.project.bpm, beats: doc.project.beats, master_gain: doc.project.master_gain, master_effects: doc.project.master_effects, tempo_map: doc.project.tempo_map ?? [], markers: doc.project.markers ?? [], ...(doc.project.loop_end_ms ? { loop_start_ms: doc.project.loop_start_ms ?? 0, loop_end_ms: doc.project.loop_end_ms, loop_on: !!doc.project.loop_on, punch_on: !!doc.project.punch_on } : {}) } as Op,
    ...doc.lanes.filter((l) => l.kind === 'bus').map(lane),
    ...doc.lanes.filter((l) => l.kind !== 'bus').map(lane),
    ...doc.lanes.filter((l) => l.kind !== 'bus' && (l.output_id || Object.keys(l.sends ?? {}).length)).map((l): Op => ({ op: 'lane.put', lane: { id: laneMap.get(l.id)!, output_id: l.output_id ? laneMap.get(l.output_id) ?? null : null, sends: Object.fromEntries(Object.entries(l.sends ?? {}).map(([k, v]) => [laneMap.get(k) ?? k, v])) } })),
    ...doc.clips.filter((c) => laneMap.has(c.lane_id) && (!c.audio_id || audioMap.has(c.audio_id))).map((c): Op => ({ op: 'clip.put', clip: { id: newId(), lane_id: laneMap.get(c.lane_id)!, audio_id: c.audio_id ? audioMap.get(c.audio_id)! : undefined, start_ms: c.start_ms, in_ms: c.in_ms, length_ms: c.length_ms, gain: c.gain, fade_in_ms: c.fade_in_ms, fade_out_ms: c.fade_out_ms, muted: c.muted, ...(c.notes ? { notes: c.notes } : {}), ...(c.group_id ? { group_id: c.group_id } : {}) } })),
  ]
  for (let i = 0; i < ops.length; i += 400) await api.post(`/studio/projects/${project.id}/ops`, { ops: ops.slice(i, i + 400) })
  await api.put(`/channels/${channelId}/studio/project`, { project_id: project.id })
  return project
}
