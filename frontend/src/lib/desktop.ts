// No imports: prefs.ts uses this at boot, before the store exists.
const isDesktop = () => typeof navigator !== 'undefined' && /ParleyDesktop\//.test(navigator.userAgent)

/**
 * Commands of the Tauri desktop shell (desktop/src-tauri, capabilities/remote.json). Shells built before these
 * existed have none: every call is then a quiet no-op, and `desktopBridge()` is false so their settings stay hidden.
 */
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
const invoke = (): Invoke | null => {
  if (!isDesktop()) return null
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__?.invoke
  return typeof i === 'function' ? i : null
}

export const desktopBridge = () => !!invoke()

export interface DesktopSettings { autostart: boolean; start_minimized: boolean; hardware_acceleration: boolean; version: string }

let lastBadge = -1
export const desktop = {
  badge(count: number) { const i = invoke(); if (!i || count === lastBadge) return; lastBadge = count; i('set_badge', { count: Math.max(0, Math.min(count, 9999)) }).catch(() => {}) },
  flash() { invoke()?.('flash').catch(() => {}) },
  /** Native zoom (true page zoom, crisper than CSS zoom). False when the shell can't. */
  zoom(factor: number): boolean { const i = invoke(); if (!i) return false; i('set_zoom', { factor }).catch(() => {}); return true },
  settings: () => invoke()?.<DesktopSettings>('desktop_settings') ?? Promise.reject(new Error('Not in the desktop app')),
  setSettings: (s: { autostart?: boolean; startMinimized?: boolean; hardwareAcceleration?: boolean }) => invoke()?.<DesktopSettings>('set_desktop_settings', s) ?? Promise.reject(new Error('Not in the desktop app')),
}
