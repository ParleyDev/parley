import { useStore } from '../store'

/**
 * Short synthesised sound effects (Web Audio, no asset files): new message, mention, voice join/leave,
 * mute/unmute, deafen/undeafen. Honours the sound settings and never plays while deafened. Every play is
 * appended to window.__parleySfx so tests can observe it.
 */
export type Sfx = 'message' | 'mention' | 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect'

type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number }
const SOUNDS: Record<Sfx, Note[]> = {
  message: [{ f: 880, at: 0, dur: 0.09 }, { f: 1175, at: 0.09, dur: 0.16 }],
  mention: [{ f: 988, at: 0, dur: 0.08 }, { f: 1319, at: 0.09, dur: 0.08 }, { f: 1760, at: 0.18, dur: 0.2 }],
  join: [{ f: 523, at: 0, dur: 0.1, type: 'triangle' }, { f: 784, at: 0.1, dur: 0.18, type: 'triangle' }],
  leave: [{ f: 784, at: 0, dur: 0.1, type: 'triangle' }, { f: 523, at: 0.1, dur: 0.18, type: 'triangle' }],
  mute: [{ f: 392, at: 0, dur: 0.07, type: 'square', gain: 0.5 }, { f: 294, at: 0.08, dur: 0.1, type: 'square', gain: 0.5 }],
  unmute: [{ f: 294, at: 0, dur: 0.07, type: 'square', gain: 0.5 }, { f: 392, at: 0.08, dur: 0.1, type: 'square', gain: 0.5 }],
  deafen: [{ f: 330, at: 0, dur: 0.08, type: 'square', gain: 0.5 }, { f: 247, at: 0.09, dur: 0.08, type: 'square', gain: 0.5 }, { f: 196, at: 0.18, dur: 0.14, type: 'square', gain: 0.5 }],
  undeafen: [{ f: 196, at: 0, dur: 0.08, type: 'square', gain: 0.5 }, { f: 247, at: 0.09, dur: 0.08, type: 'square', gain: 0.5 }, { f: 330, at: 0.18, dur: 0.14, type: 'square', gain: 0.5 }],
  disconnect: [{ f: 440, at: 0, dur: 0.12, type: 'sawtooth', gain: 0.35 }, { f: 220, at: 0.14, dur: 0.25, type: 'sawtooth', gain: 0.35 }],
}

const MESSAGE_KINDS: Sfx[] = ['message', 'mention']
/** Feedback for your own action still plays while deafened; everything else is silenced by deafen. */
const SELF_KINDS: Sfx[] = ['mute', 'unmute', 'deafen', 'undeafen']
let ctx: AudioContext | null = null
let lastAt: Partial<Record<Sfx, number>> = {}

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Route effects to the chosen output device where the browser allows it (Chromium). */
export function applySfxSink(deviceId: string) {
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (c?.setSinkId) c.setSinkId(deviceId || '').catch(() => {})
}

/** Is this effect enabled by the user's settings right now? */
export function sfxEnabled(kind: Sfx): boolean {
  const s = useStore.getState()
  if (s.selfDeaf && !SELF_KINDS.includes(kind)) return false
  const v = s.voiceSettings
  if (MESSAGE_KINDS.includes(kind)) return v.messageSounds
  return v.voiceSounds
}

/** Play an effect (if enabled). `force` ignores the settings, for the preview buttons. */
export function playSfx(kind: Sfx, force = false) {
  const w = window as unknown as { __parleySfx?: Sfx[] }
  if (!force && !sfxEnabled(kind)) return
  // Debounce bursts: a flood of messages makes one sound, not a machine gun.
  const now = Date.now()
  if (!force && now - (lastAt[kind] ?? 0) < 250) return
  lastAt[kind] = now
  ;(w.__parleySfx ??= []).push(kind)
  const c = context()
  if (!c) return
  const vol = Math.max(0, Math.min(1, useStore.getState().voiceSettings.soundVolume / 100)) * 0.25
  if (vol === 0) return
  const t0 = c.currentTime + 0.01
  for (const n of SOUNDS[kind]) {
    const o = c.createOscillator(); o.type = n.type ?? 'sine'; o.frequency.value = n.f
    const g = c.createGain(); g.gain.setValueAtTime(0, t0 + n.at)
    g.gain.linearRampToValueAtTime(vol * (n.gain ?? 1), t0 + n.at + 0.01)
    g.gain.setValueAtTime(vol * (n.gain ?? 1), t0 + n.at + n.dur - 0.03)
    g.gain.linearRampToValueAtTime(0, t0 + n.at + n.dur)
    o.connect(g); g.connect(c.destination)
    o.start(t0 + n.at); o.stop(t0 + n.at + n.dur + 0.02)
  }
}

/** Reset the debounce (tests). */
export function resetSfx() { lastAt = {} }

declare global { interface Window { __parleySfx?: Sfx[] } }
