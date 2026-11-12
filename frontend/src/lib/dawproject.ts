// DAWproject (https://github.com/bitwig/dawproject, MIT): the open project format Bitwig Studio, Studio One, Cubase
// and others read and write. A .dawproject file is a zip of project.xml (tracks, mixer, arrangement), metadata.xml
// and the audio. We write time in seconds (every reader supports it), audio as WAV (takes are WebM/Opus, which desktop
// DAWs don't read), the EQ, compressor and limiter as the format's built-in devices, and note the effects it has no
// equivalent for in the track's comment. Reading takes seconds or beats, nested clips, audio, notes, levels, sends,
// routing, markers and volume / pan automation.
import { api, getToken } from './api'
import { newId, sortedLanes, useDaw, type Op } from './daw'
import { unzip, zip } from './exporters'
import { FX, type Effect } from './fx'
import { encodeWav } from './multitrack'
import { download } from './fileActions'
import { secAtBar } from './tempo'
import type { Note } from './instruments'
import type { StudioClip, StudioLane, StudioProject, StudioTrack } from './types'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (x: number) => (Math.round(x * 1e6) / 1e6).toString()
const sec = (ms: number) => num(ms / 1000)
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project'
const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Effects the format has a built-in device for, as XML (its schema wants the parameters in alphabetical order). */
function device(e: Effect, id: () => string): string | null {
  const p = (k: string) => e.params[k] ?? FX[e.type]?.params.find((x) => x.key === k)?.def ?? 0
  const real = (tag: string, value: number, unit: string, min: number, max: number) => `<${tag} id="${id()}" name="${tag}" unit="${unit}" value="${num(value)}" min="${num(min)}" max="${num(max)}"/>`
  const on = `<Enabled id="${id()}" name="On" value="${e.on}"/>`
  if (e.type === 'eq') {
    const band = (type: string, freq: number, gain: number | null, order = 0) => `<Band type="${type}"${order ? ` order="${order}"` : ''}>${real('Freq', freq, 'hertz', 20, 20000)}${gain === null ? '' : real('Gain', gain, 'decibel', -24, 24)}${real('Q', 0.707, 'linear', 0.1, 10)}<Enabled id="${id()}" name="Enabled" value="true"/></Band>`
    return `<Equalizer deviceRole="audioFX" deviceName="EQ" id="${id()}">${on}${band('highPass', p('lowcut'), null, 2)}${band('lowShelf', 120, p('low'))}${band('bell', p('midFreq'), p('mid'))}${band('highShelf', 8000, p('high'))}</Equalizer>`
  }
  if (e.type === 'compressor') return `<Compressor deviceRole="audioFX" deviceName="Compressor" id="${id()}">${on}${real('Attack', p('attack') / 1000, 'seconds', 0, 1)}${real('OutputGain', p('makeup'), 'decibel', -24, 24)}${real('Ratio', p('ratio'), 'linear', 1, 20)}${real('Release', p('release') / 1000, 'seconds', 0, 2)}${real('Threshold', p('threshold'), 'decibel', -60, 0)}</Compressor>`
  if (e.type === 'limiter') return `<Limiter deviceRole="audioFX" deviceName="Limiter" id="${id()}">${on}${real('Release', p('release') / 1000, 'seconds', 0, 2)}${real('Threshold', p('ceiling'), 'decibel', -24, 0)}</Limiter>`
  return null
}

/** Decode any audio the browser can play and write it as 16-bit WAV. */
async function toWav(data: ArrayBuffer): Promise<{ wav: ArrayBuffer; channels: number; rate: number; seconds: number }> {
  const ctx = new OfflineAudioContext(1, 1, 48000)
  const buf = await ctx.decodeAudioData(data)
  return { wav: encodeWav(buf), channels: buf.numberOfChannels, rate: buf.sampleRate, seconds: buf.duration }
}

/** The open project as a .dawproject file, with its audio as WAV. */
export async function exportDawProject(onProgress?: (done: number, total: number) => void) {
  const { project, lanes, clips, audio } = useDaw.getState()
  if (!project) return
  let n = 0
  const id = () => `id${n++}`
  const token = getToken()
  // Audio first: every file a clip uses, decoded and written as WAV.
  const used = [...new Set(Object.values(clips).map((c) => c.audio_id).filter((x): x is string => !!x && !!audio[x]))]
  const files: { name: string; data: Uint8Array }[] = []
  const media = new Map<string, { path: string; channels: number; rate: number; seconds: number }>()
  for (const [i, aid] of used.entries()) {
    onProgress?.(i, used.length)
    const a = audio[aid]
    const r = await fetch(a.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!r.ok) continue
    try {
      const w = await toWav(await r.arrayBuffer())
      const path = `audio/${safe(a.name?.replace(/\.[a-z0-9]+$/i, '') ?? a.display_name)}-${aid.slice(0, 8)}.wav`
      files.push({ name: path, data: new Uint8Array(w.wav) })
      media.set(aid, { path, channels: w.channels, rate: w.rate, seconds: w.seconds })
    } catch { /* undecodable: left out */ }
  }
  onProgress?.(used.length, used.length)
  const ordered = sortedLanes(lanes)
  const master = { track: id(), channel: id() }
  const ids = new Map(ordered.map((l) => [l.id, { track: id(), channel: id(), volume: id(), pan: id(), mute: id(), sends: {} as Record<string, string> }]))
  const parts: string[] = []
  const trackXml = (l: StudioLane) => {
    const x = ids.get(l.id)!
    const role = l.kind === 'bus' ? 'effect' : 'regular'
    const dest = l.output_id && ids.has(l.output_id) ? ids.get(l.output_id)!.channel : master.channel
    const devices = (l.effects ?? []).map((e) => device(e, id)).filter(Boolean)
    const missing = (l.effects ?? []).filter((e) => !['eq', 'compressor', 'limiter'].includes(e.type)).map((e) => `${FX[e.type]?.name ?? e.type} ${Object.entries(e.params).map(([k, v]) => `${k}=${num(v)}`).join(' ')}`)
    const inst = l.kind === 'midi' && l.instrument ? `Parley ${l.instrument.type} instrument` : ''
    const comment = [inst, missing.length ? `Effects not carried over: ${missing.join('; ')}` : ''].filter(Boolean).join('. ')
    const sends = Object.entries(l.sends ?? {}).filter(([bus]) => ids.has(bus)).map(([bus, level]) => { const sid = id(); x.sends[bus] = sid; return `<Send destination="${ids.get(bus)!.channel}" type="post" id="${id()}"><Volume id="${sid}" name="Send" unit="linear" value="${num(level)}" min="0" max="2"/></Send>` }).join('')
    return `<Track contentType="${l.kind === 'midi' ? 'notes' : 'audio'}" loaded="true" id="${x.track}" name="${esc(l.name)}"${l.color ? ` color="${esc(l.color)}"` : ''}${comment ? ` comment="${esc(comment)}"` : ''}>`
      + `<Channel audioChannels="2" destination="${dest}" role="${role}" solo="${l.solo}" id="${x.channel}">`
      + (devices.length ? `<Devices>${devices.join('')}</Devices>` : '')
      + `<Mute id="${x.mute}" name="Mute" value="${l.mute}"/><Pan id="${x.pan}" name="Pan" unit="normalized" value="${num((l.pan + 1) / 2)}" min="0" max="1"/>`
      + (sends ? `<Sends>${sends}</Sends>` : '')
      + `<Volume id="${x.volume}" name="Volume" unit="linear" value="${num(l.gain)}" min="0" max="2"/></Channel></Track>`
  }
  const masterDevices = (project.master_effects ?? []).map((e) => device(e, id)).filter(Boolean)
  const tempoId = id(), sigId = id()
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Project version="1.0">', '<Application name="Parley" version="1"/>')
  parts.push(`<Transport><Tempo id="${tempoId}" name="Tempo" unit="bpm" value="${num(project.bpm)}" min="20" max="999"/><TimeSignature id="${sigId}" numerator="${project.beats}" denominator="4"/></Transport>`)
  parts.push('<Structure>', ...ordered.filter((l) => l.kind === 'bus').map(trackXml), ...ordered.filter((l) => l.kind !== 'bus').map(trackXml))
  parts.push(`<Track contentType="audio notes" loaded="true" id="${master.track}" name="Master"><Channel audioChannels="2" role="master" solo="false" id="${master.channel}">${masterDevices.length ? `<Devices>${masterDevices.join('')}</Devices>` : ''}<Volume id="${id()}" name="Volume" unit="linear" value="${num(project.master_gain)}" min="0" max="2"/></Channel></Track>`)
  parts.push('</Structure>')
  // The arrangement: per track its clips, then its volume / pan / send automation.
  parts.push(`<Arrangement id="${id()}"><Lanes timeUnit="seconds" id="${id()}">`)
  for (const l of ordered) {
    const x = ids.get(l.id)!
    const mine = Object.values(clips).filter((c) => c.lane_id === l.id).sort((a, b) => a.start_ms - b.start_ms)
    const clipXml = (c: StudioClip) => {
      const at = Math.max(0, c.start_ms + (l.nudge_ms ?? 0))
      const fades = c.fade_in_ms || c.fade_out_ms ? ` fadeTimeUnit="seconds" fadeInTime="${sec(c.fade_in_ms)}" fadeOutTime="${sec(c.fade_out_ms)}"` : ''
      const enable = c.muted ? ' enable="false"' : ''
      if (c.notes) {
        const notes = (c.notes as Note[]).map((nt) => `<Note time="${sec(nt.t)}" duration="${sec(nt.d)}" channel="0" key="${nt.p}" vel="${num(Math.min(1, nt.v / 127))}" rel="${num(Math.min(1, nt.v / 127))}"/>`).join('')
        return `<Clip time="${sec(at)}" duration="${sec(c.length_ms)}" playStart="0" contentTimeUnit="seconds"${enable}><Notes id="${id()}">${notes}</Notes></Clip>`
      }
      const m = c.audio_id ? media.get(c.audio_id) : undefined
      if (!m) return ''
      return `<Clip time="${sec(at)}" duration="${sec(c.length_ms)}" playStart="${sec(c.in_ms)}" contentTimeUnit="seconds"${fades}${enable}><Audio id="${id()}" channels="${m.channels}" sampleRate="${m.rate}" duration="${num(m.seconds)}" algorithm="raw"><File path="${esc(m.path)}"/></Audio></Clip>`
    }
    const auto = Object.entries(l.automation ?? {}).map(([key, pts]) => {
      const target = key === 'gain' ? x.volume : key === 'pan' ? x.pan : key.startsWith('send:') ? x.sends[key.slice(5)] : undefined
      if (!target || !pts?.length) return ''
      const unit = key === 'pan' ? 'normalized' : 'linear'
      return `<Points id="${id()}" unit="${unit}"><Target parameter="${target}"/>${pts.map(([ms, v]) => `<RealPoint time="${sec(ms)}" value="${num(key === 'pan' ? (v + 1) / 2 : v)}" interpolation="linear"/>`).join('')}</Points>`
    }).join('')
    parts.push(`<Lanes track="${x.track}" id="${id()}"><Clips id="${id()}">${mine.map(clipXml).join('')}</Clips>${auto}</Lanes>`)
  }
  parts.push('</Lanes>')
  if (project.markers?.length) parts.push(`<Markers id="${id()}">${project.markers.map((mk) => `<Marker time="${sec(mk.ms)}" name="${esc(mk.name)}"/>`).join('')}</Markers>`)
  const changes = (project.tempo_map ?? []).filter((c) => c.bar > 0)
  if (changes.length) {
    parts.push(`<TempoAutomation id="${id()}" unit="bpm" timeUnit="seconds"><Target parameter="${tempoId}"/><RealPoint time="0" value="${num(project.bpm)}" interpolation="hold"/>${changes.map((c) => `<RealPoint time="${num(secAtBar(project, c.bar))}" value="${num(c.bpm)}" interpolation="hold"/>`).join('')}</TempoAutomation>`)
    parts.push(`<TimeSignatureAutomation id="${id()}" timeUnit="seconds"><Target parameter="${sigId}"/><TimeSignaturePoint time="0" numerator="${project.beats}" denominator="4"/>${changes.map((c) => `<TimeSignaturePoint time="${num(secAtBar(project, c.bar))}" numerator="${c.beats}" denominator="4"/>`).join('')}</TimeSignatureAutomation>`)
  }
  parts.push('</Arrangement><Scenes/></Project>')
  const meta = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><MetaData><Title>${esc(project.name)}</Title><Comment>Exported from Parley</Comment></MetaData>`
  const enc = new TextEncoder()
  const blob = zip([{ name: 'project.xml', data: enc.encode(parts.join('\n')) }, { name: 'metadata.xml', data: enc.encode(meta) }, ...files])
  ;(window as unknown as Record<string, unknown>).__parleyDawProject = { size: blob.size, xml: parts.join('\n'), files: files.map((f) => f.name) }
  const url = URL.createObjectURL(blob)
  await download(url, `${safe(project.name)}.dawproject`)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag)
const kid = (el: Element, tag: string) => kids(el, tag)[0]
const attr = (el: Element | undefined, k: string) => el?.getAttribute(k) ?? null
const fnum = (el: Element | undefined, k: string, d = 0) => { const v = Number(attr(el, k)); return Number.isFinite(v) && attr(el, k) !== null ? v : d }
const TYPES: Record<string, string> = { wav: 'audio/wav', wave: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff', webm: 'audio/webm' }

/** Read a .dawproject file into the studio `studioId` as a new project. Returns the project and what was left out. */
export async function importDawProject(studioId: string, file: File): Promise<{ project: StudioProject; skipped: string[] }> {
  const entries = await unzip(await file.arrayBuffer())
  const xml = entries.get('project.xml')
  if (!xml) throw new Error('Not a DAWproject file')
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml')
  const root = doc.documentElement
  if (root.tagName !== 'Project') throw new Error('Not a DAWproject file')
  const skipped: string[] = []
  const transport = kid(root, 'Transport')
  const bpm = Math.round(Math.min(300, Math.max(40, fnum(kid(transport ?? root, 'Tempo'), 'value', 120))))
  const beats = Math.round(Math.min(12, Math.max(1, fnum(kid(transport ?? root, 'TimeSignature'), 'numerator', 4))))
  const metaRaw = entries.get('metadata.xml')
  const title = metaRaw ? new DOMParser().parseFromString(new TextDecoder().decode(metaRaw), 'application/xml').querySelector('Title')?.textContent?.trim() : ''
  const name = title || file.name.replace(/\.dawproject$/i, '')
  // Time in beats is read at the project's tempo.
  const toMs = (v: number, unit: string | null) => Math.round(unit === 'beats' ? (v * 60000) / bpm : v * 1000)

  // Tracks (groups nest them): a regular channel is an audio or MIDI track, an effect channel a bus.
  type T = { el: Element; lane: string; channel: Element | undefined; kind: 'audio' | 'midi' | 'bus' }
  const tracks: T[] = []
  const byChannel = new Map<string, T>(), byTrack = new Map<string, T>(), params = new Map<string, { lane: string; key: string }>()
  const walk = (el: Element) => {
    for (const t of kids(el, 'Track')) {
      const ch = kid(t, 'Channel')
      const role = attr(ch, 'role') ?? 'regular'
      const content = attr(t, 'contentType') ?? ''
      if (ch && role !== 'master' && (role === 'regular' || role === 'effect' || role === 'submix')) {
        const x: T = { el: t, lane: newId(), channel: ch, kind: role === 'regular' ? (content.includes('notes') && !content.includes('audio') ? 'midi' : 'audio') : 'bus' }
        tracks.push(x)
        byTrack.set(attr(t, 'id') ?? '', x)
        if (ch) byChannel.set(attr(ch, 'id') ?? '', x)
      }
      walk(t)
    }
  }
  walk(kid(root, 'Structure') ?? root)
  if (!tracks.length) throw new Error('This project has no tracks to bring in')

  const project = await api.post<StudioProject>(`/channels/${studioId}/studio/projects`, { name: name.slice(0, 80), bpm, beats })
  const room = project.channel_id
  const token = getToken()
  const uploaded = new Map<string, StudioTrack>()
  const upload = async (path: string, seconds: number | null) => {
    if (uploaded.has(path)) return uploaded.get(path)!
    const data = entries.get(path) ?? entries.get(path.replace(/^\.?\//, ''))
    if (!data) { skipped.push(`missing audio ${path}`); return null }
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    let dur = seconds ? Math.round(seconds * 1000) : 0
    if (!dur) { try { dur = Math.round((await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data.slice().buffer)).duration * 1000) } catch { /* the server takes it without */ } }
    const r = await fetch(`/api/channels/${room}/studio/audio?name=${encodeURIComponent(path.split('/').pop() ?? path)}${dur ? `&duration_ms=${dur}` : ''}`, { method: 'POST', headers: { 'Content-Type': TYPES[ext] ?? 'audio/wav', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: new Blob([data.slice()]) })
    const t = await r.json().catch(() => null) as StudioTrack | null
    if (!r.ok || !t) { skipped.push(`audio ${path} (${(t as unknown as { error?: string } | null)?.error ?? r.status})`); return null }
    uploaded.set(path, t)
    return t
  }

  const ops: Op[] = []
  const routing: Op[] = []
  tracks.forEach((x, i) => {
    const ch = x.channel
    const vol = kid(ch!, 'Volume'), pan = kid(ch!, 'Pan'), mute = kid(ch!, 'Mute')
    const gain = attr(vol, 'unit') === 'decibel' ? dbToGain(fnum(vol, 'value', 0)) : fnum(vol, 'value', 1)
    const p = attr(pan, 'unit') === 'normalized' || fnum(pan, 'max', 1) === 1 && fnum(pan, 'min', 0) === 0 ? fnum(pan, 'value', 0.5) * 2 - 1 : fnum(pan, 'value', 0)
    if (vol) params.set(attr(vol, 'id') ?? '', { lane: x.lane, key: 'gain' })
    if (pan) params.set(attr(pan, 'id') ?? '', { lane: x.lane, key: 'pan' })
    const devices = kid(ch!, 'Devices')
    if (devices?.children.length) skipped.push(`${devices.children.length} effect(s) on ${attr(x.el, 'name') ?? 'a track'}`)
    ops.push({ op: 'lane.put', lane: { id: x.lane, name: (attr(x.el, 'name') ?? `Track ${i + 1}`).slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(attr(x.el, 'color') ?? '') ? attr(x.el, 'color')! : '', position: i, kind: x.kind, gain: Math.min(2, Math.max(0, gain)), pan: Math.min(1, Math.max(-1, p)), mute: attr(mute, 'value') === 'true', solo: attr(ch!, 'solo') === 'true' } } as Op)
    const dest = byChannel.get(attr(ch!, 'destination') ?? '')
    const sends: Record<string, number> = {}
    for (const s of kids(kid(ch!, 'Sends') ?? ch!, 'Send')) {
      const bus = byChannel.get(attr(s, 'destination') ?? '')
      const sv = kid(s, 'Volume')
      if (bus?.kind === 'bus') { sends[bus.lane] = Math.min(1.5, Math.max(0, attr(sv, 'unit') === 'decibel' ? dbToGain(fnum(sv, 'value', 0)) : fnum(sv, 'value', 1))); if (sv) params.set(attr(sv, 'id') ?? '', { lane: x.lane, key: `send:${bus.lane}` }) }
    }
    if (x.kind !== 'bus' && ((dest && dest.kind === 'bus') || Object.keys(sends).length)) routing.push({ op: 'lane.put', lane: { id: x.lane, ...(dest?.kind === 'bus' ? { output_id: dest.lane } : {}), ...(Object.keys(sends).length ? { sends } : {}) } } as Op)
  })

  // The arrangement: clips (nested clips add up), notes, and automation points per track.
  const clipOps: Op[] = []
  const automation = new Map<string, Record<string, [number, number][]>>()
  const arrangement = kid(root, 'Arrangement')
  const readClips = async (clipsEl: Element, x: T, unit: string | null, base: number) => {
    for (const c of kids(clipsEl, 'Clip')) {
      const cu = attr(c, 'contentTimeUnit') ?? unit
      const at = base + toMs(fnum(c, 'time'), unit)
      const len = toMs(fnum(c, 'duration'), unit)
      const play = toMs(fnum(c, 'playStart'), cu)
      const fu = attr(c, 'fadeTimeUnit') ?? unit
      const nested = kid(c, 'Clips')
      if (nested) { await readClips(nested, x, cu, at - play); continue }
      const notesEl = kid(c, 'Notes') ?? c.querySelector('Notes') ?? undefined
      const audioEl = kid(c, 'Audio') ?? c.querySelector('Audio') ?? undefined
      const muted = attr(c, 'enable') === 'false'
      if (notesEl && x.kind === 'midi') {
        const notes: Note[] = kids(notesEl, 'Note').map((nt) => ({ p: Math.round(fnum(nt, 'key', 60)), t: Math.max(0, toMs(fnum(nt, 'time'), cu) - play), d: Math.max(10, toMs(fnum(nt, 'duration'), cu)), v: Math.round(Math.min(1, fnum(nt, 'vel', 0.8)) * 127) })).filter((nt) => nt.t < len)
        clipOps.push({ op: 'clip.put', clip: { id: newId(), lane_id: x.lane, start_ms: Math.max(0, at), length_ms: Math.max(1, len), notes, muted } } as Op)
      } else if (audioEl) {
        const path = attr(kid(audioEl, 'File'), 'path')
        if (!path) continue
        const t = await upload(path, fnum(audioEl, 'duration', 0) || null)
        if (!t) continue
        const audioLen = t.duration_ms ?? len + play
        const inMs = Math.min(Math.max(0, play), Math.max(0, audioLen - 1))
        clipOps.push({ op: 'clip.put', clip: { id: newId(), lane_id: x.lane, audio_id: t.id, start_ms: Math.max(0, at), in_ms: inMs, length_ms: Math.max(1, Math.min(len, audioLen - inMs)), fade_in_ms: toMs(fnum(c, 'fadeInTime'), fu), fade_out_ms: toMs(fnum(c, 'fadeOutTime'), fu), muted } } as Op)
      } else if (notesEl) skipped.push(`notes on audio track ${attr(x.el, 'name') ?? ''}`)
    }
  }
  const readLanes = async (lanesEl: Element, unit: string | null, x: T | undefined) => {
    const u = attr(lanesEl, 'timeUnit') ?? unit
    const mine = byTrack.get(attr(lanesEl, 'track') ?? '') ?? x
    for (const child of lanesEl.children) {
      if (child.tagName === 'Lanes') await readLanes(child, u, mine)
      else if (child.tagName === 'Clips' && mine) await readClips(child, mine, attr(child, 'timeUnit') ?? u, 0)
      else if (child.tagName === 'Points') {
        const target = params.get(attr(kid(child, 'Target'), 'parameter') ?? '')
        if (!target) { skipped.push('automation of a parameter Parley lacks'); continue }
        const pu = attr(child, 'timeUnit') ?? u
        const pts = kids(child, 'RealPoint').map((pt): [number, number] => { const v = fnum(pt, 'value'); return [Math.max(0, toMs(fnum(pt, 'time'), pu)), target.key === 'pan' ? v * 2 - 1 : attr(child, 'unit') === 'decibel' ? dbToGain(v) : v] })
        if (pts.length) automation.set(target.lane, { ...automation.get(target.lane), [target.key]: pts })
      }
    }
  }
  const top = arrangement ? kid(arrangement, 'Lanes') : undefined
  if (top) await readLanes(top, attr(top, 'timeUnit') ?? 'beats', undefined)
  const markersEl = arrangement ? kid(arrangement, 'Markers') : undefined
  const markers = markersEl ? kids(markersEl, 'Marker').map((m, i) => ({ id: `m${i}`, ms: toMs(fnum(m, 'time'), attr(markersEl, 'timeUnit') ?? attr(top ?? root, 'timeUnit') ?? 'beats'), name: (attr(m, 'name') ?? `Marker ${i + 1}`).slice(0, 40) })).slice(0, 200) : []
  if (arrangement && kid(arrangement, 'TempoAutomation')) skipped.push('tempo changes (the first tempo is kept)')
  const autoOps: Op[] = [...automation.entries()].map(([lane, a]) => ({ op: 'lane.put', lane: { id: lane, automation: a } }) as Op)
  const all: Op[] = [{ op: 'project', markers } as Op, ...ops.filter((o) => (o as { lane: StudioLane }).lane.kind === 'bus'), ...ops.filter((o) => (o as { lane: StudioLane }).lane.kind !== 'bus'), ...routing, ...clipOps, ...autoOps]
  for (let i = 0; i < all.length; i += 400) await api.post(`/studio/projects/${project.id}/ops`, { ops: all.slice(i, i + 400) })
  return { project, skipped }
}

