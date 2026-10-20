import { STORAGE_PREFIX } from './brand'
export interface VoiceSettings {
  inputDeviceId: string            // '' = system default
  outputDeviceId: string
  cameraDeviceId: string
  inputVolume: number              // 0..200 (%)
  outputVolume: number             // 0..200 (%)
  inputMode: 'vad' | 'ptt'
  pttKey: string                   // KeyboardEvent.code
  pttRelease: number               // ms to keep transmitting after key release
  autoSensitivity: boolean
  sensitivity: number              // dBFS threshold, -100..0, used when !autoSensitivity
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  /** Play a ringtone while an incoming DM call banner is showing (never while deafened). */
  ringtone: boolean
  /** Sound on a new message that would notify you (DMs, mentions, unmuted channels) while you are not looking at it. */
  messageSounds: boolean
  /** Sounds for voice: someone joins/leaves your call, and your own mute/unmute/deafen. */
  voiceSounds: boolean
  /** Volume of those effects, 0..100 (%). */
  soundVolume: number
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  cameraDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  inputMode: 'vad',
  pttKey: 'Backquote',
  pttRelease: 200,
  autoSensitivity: true,
  sensitivity: -50,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ringtone: true,
  messageSounds: true,
  voiceSounds: true,
  soundVolume: 100,
}

const KEY = `${STORAGE_PREFIX}voiceSettings`

export function loadSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<VoiceSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: VoiceSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

/** Human label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const map: Record<string, string> = {
    Backquote: '`', Space: 'Space', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Meta', MetaRight: 'Right Meta', CapsLock: 'Caps Lock', Tab: 'Tab',
  }
  return map[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export const supportsSinkId = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
