import { create } from 'zustand'
import { useDaw, engine, edit, newId } from './daw'
import { audition } from '../components/DawInstrument'
import { barBeat, secAtBar } from './tempo'
import type { Note } from './instruments'

/**
 * Playing and recording MIDI tracks: notes come from MIDI keyboards (Web MIDI) or the computer keyboard (A W S E D F
 * T G Y H U J K for an octave from C, Z / X to shift octaves). They sound on the MIDI track you arm (the ● on its
 * header, on this device only), and while the project plays they are recorded: on stop they become a clip on that
 * track, from the bar of the first note to the end of the bar of the last.
 */
interface MidiState { lane: string | null; keys: boolean; devices: string[]; octave: number; held: number[] }
export const useMidi = create<MidiState>(() => ({ lane: null, keys: false, devices: [], octave: 4, held: [] }))
const get = useMidi.getState, set = useMidi.setState

const sounding = new Map<number, (at?: number) => void>()
let take: { notes: Note[]; open: Map<number, Note> } | null = null

export function armMidi(lane: string | null) { set({ lane }) }

export function noteOn(p: number, v = 100) {
  const id = get().lane
  const lane = id ? useDaw.getState().lanes[id] : undefined
  if (!lane) return
  sounding.get(p)?.()
  sounding.set(p, audition(lane, p, v, null))
  set({ held: [...get().held.filter((x) => x !== p), p] })
  if (engine.playing === 'local' || engine.playing === 'shared') {
    take ??= { notes: [], open: new Map() }
    const n: Note = { p, t: Math.round(engine.position() * 1000), d: 1, v }
    take.notes.push(n); take.open.set(p, n)
  }
}
export function noteOff(p: number) {
  sounding.get(p)?.(); sounding.delete(p)
  set({ held: get().held.filter((x) => x !== p) })
  const n = take?.open.get(p)
  if (n) { n.d = Math.max(20, Math.round(engine.position() * 1000) - n.t); take!.open.delete(p) }
}

/** Playback stopped: what was played becomes a clip on the armed track. */
function commit() {
  const t = take
  take = null
  const id = get().lane
  const { project, lanes } = useDaw.getState()
  if (!t || !t.notes.length || !id || !project || !lanes[id]) return
  const end = Math.round(engine.position() * 1000) || Math.max(...t.notes.map((n) => n.t + 250))
  for (const n of t.open.values()) n.d = Math.max(20, end - n.t)
  const first = Math.min(...t.notes.map((n) => n.t)), last = Math.max(...t.notes.map((n) => n.t + n.d))
  const startMs = Math.round(secAtBar(project, barBeat(project, first / 1000).bar - 1) * 1000)
  const endMs = Math.round(secAtBar(project, barBeat(project, last / 1000).bar) * 1000)
  edit([{ op: 'clip.put', clip: { id: newId(), lane_id: id, start_ms: startMs, length_ms: Math.max(1, endMs - startMs), notes: t.notes.map((n) => ({ ...n, t: n.t - startMs })) } }])
}
engine.subscribe(() => { if (!engine.playing && take) commit() })

/** Connect MIDI inputs; the names of those found. */
export async function connectMidi(): Promise<string[]> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }
  if (!nav.requestMIDIAccess) throw new Error('This browser has no MIDI support')
  const access = await nav.requestMIDIAccess()
  const hook = () => {
    const names: string[] = []
    access.inputs.forEach((input) => {
      names.push(input.name ?? 'MIDI input')
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const [st, p, v] = e.data ?? []
        const cmd = st & 0xf0
        if (cmd === 0x90 && v > 0) noteOn(p, v)
        else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) noteOff(p)
      }
    })
    set({ devices: names })
    return names
  }
  access.onstatechange = () => { hook() }
  return hook()
}

const KEYS = 'awsedftgyhujk'
/** The computer keyboard as a piano while `keys` is on (not while typing in a field). */
function keyboard() {
  const down = new Set<string>()
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable) }
  window.addEventListener('keydown', (e) => {
    if (!get().keys || e.ctrlKey || e.metaKey || e.altKey || typing()) return
    const k = e.key.toLowerCase()
    if (k === 'z' || k === 'x') { set({ octave: Math.max(0, Math.min(8, get().octave + (k === 'z' ? -1 : 1))) }); e.preventDefault(); return }
    const i = KEYS.indexOf(k)
    if (i < 0 || e.repeat || down.has(k)) { if (i >= 0) e.preventDefault(); return }
    e.preventDefault(); e.stopPropagation()
    down.add(k); noteOn(12 * (get().octave + 1) + i, 100)
  }, true)
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase(), i = KEYS.indexOf(k)
    if (i < 0 || !down.has(k)) return
    down.delete(k); noteOff(12 * (get().octave + 1) + i)
  }, true)
}
if (typeof window !== 'undefined') keyboard()
