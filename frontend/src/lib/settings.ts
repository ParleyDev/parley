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
}

const KEY = 'y99.voiceSettings'

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
