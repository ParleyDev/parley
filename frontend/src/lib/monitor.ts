import { chainKey, buildChain, type FxNode } from './fx'
import { engine, useDaw } from './daw'
import type { StudioLane } from './types'
import { useStore } from '../store'

/**
 * Input monitoring, as in a desktop DAW: on my tracks set to monitor In (always) or Auto (while armed), I hear the
 * track's live input through its effects, volume and pan, here only (it never goes into the recording or the call).
 * Wear headphones: through speakers it feeds back.
 */
type Mon = { key: string; stream: MediaStream; src: MediaStreamAudioSourceNode; fx: Map<string, FxNode>; vol: GainNode; pan: StereoPannerNode }
const mons = new Map<string, Mon>()

const wanted = (l: StudioLane, me: string) => l.kind === 'audio' && l.user_id === me && (l.monitor === 'in' || (l.monitor === 'auto' && !!l.armed))
const keyOf = (l: StudioLane) => [l.input?.device ?? '', l.input?.channel ?? 'mono', chainKey(l.effects ?? [])].join('|')

function drop(id: string) {
  const m = mons.get(id)
  if (!m) return
  mons.delete(id)
  m.src.disconnect(); m.fx.forEach((f) => f.stop()); m.vol.disconnect(); m.pan.disconnect()
  m.stream.getTracks().forEach((tr) => tr.stop())
}

async function open(l: StudioLane) {
  const ctx = engine.audio()
  ctx.resume().catch(() => {})
  const device = l.input?.device ?? ''
  const id = device ? (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === device)?.deviceId : undefined
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(id ? { deviceId: { exact: id } } : {}), channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const src = ctx.createMediaStreamSource(stream)
  const input = ctx.createGain(), vol = ctx.createGain(), pan = ctx.createStereoPanner()
  const ch = l.input?.channel ?? 'mono'
  if (ch === '1' || ch === '2') { const split = ctx.createChannelSplitter(2); src.connect(split); split.connect(input, ch === '1' ? 0 : 1) }
  else { input.channelCount = ch === '1/2' ? 2 : 1; input.channelCountMode = 'explicit'; src.connect(input) }
  const fx = buildChain(ctx, l.effects ?? [], input, vol)
  vol.gain.value = l.gain; pan.pan.value = l.pan
  vol.connect(pan).connect(ctx.destination)
  const m: Mon = { key: keyOf(l), stream, src, fx, vol, pan }
  return m
}

let busy = false, again = false
async function sync() {
  if (busy) { again = true; return }
  busy = true
  try {
    const me = useStore.getState().user?.id
    const { project, lanes } = useDaw.getState()
    const want = me && project ? Object.values(lanes).filter((l) => wanted(l, me)) : []
    for (const id of Array.from(mons.keys())) if (!want.some((l) => l.id === id && keyOf(l) === mons.get(id)!.key)) drop(id)
    for (const l of want) {
      const m = mons.get(l.id)
      if (m) { m.vol.gain.value = l.mute ? 0 : l.gain; m.pan.pan.value = l.pan; continue }
      try { mons.set(l.id, await open(l)) } catch { /* no such input here, or refused */ }
    }
    ;(window as unknown as { __parleyMonitor?: string[] }).__parleyMonitor = [...mons.keys()]
  } finally {
    busy = false
    if (again) { again = false; void sync() }
  }
}

if (typeof window !== 'undefined') {
  useDaw.subscribe((s, p) => { if (s.lanes !== p.lanes || s.project?.id !== p.project?.id) void sync() })
}
