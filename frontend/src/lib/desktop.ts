// No imports: prefs.ts uses this at boot, before the store exists.
/** This page is the desktop app's in-game overlay: it shows, it doesn't notify, ring or badge. */
export const isOverlay = () => typeof location !== 'undefined' && location.pathname === '/overlay'
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

export interface DesktopSettings { autostart: boolean; start_minimized: boolean; hardware_acceleration: boolean; close_to_tray?: boolean; minimize_to_tray?: boolean; tray?: boolean; version: string
  /** The window has no system frame (shells from 0.21 on): "custom" = draw minimise/maximise/close, "mac" = leave room for the traffic lights. */
  frame?: 'custom' | 'mac'
  /** App updates follow releases (stable) or every build of main (dev). Shells from 0.21 on. */
  update_channel?: 'stable' | 'dev' }

/** The shell's updater: checks GitHub Releases, downloads in the background, installs on restart. */
export interface UpdateStatus { state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'unsupported' | 'error'; version?: string | null; notes?: string | null; downloaded: number; total?: number | null; error?: string | null; current: string }

let lastBadge = -1
export const desktop = {
  badge(count: number) { const i = invoke(); if (!i || isOverlay() || count === lastBadge) return; lastBadge = count; i('set_badge', { count: Math.max(0, Math.min(count, 9999)) }).catch(() => {}) },
  flash() { if (!isOverlay()) invoke()?.('flash').catch(() => {}) },
  /** Show or hide the in-game overlay; `locked` makes it click-through. False when the shell can't. */
  overlay: (show: boolean, locked?: boolean): Promise<boolean> => invoke()?.<boolean>('overlay', { show, locked }).catch(() => false) ?? Promise.resolve(false),
  /** Native zoom (true page zoom, crisper than CSS zoom). False when the shell can't. */
  zoom(factor: number): boolean { const i = invoke(); if (!i) return false; i('set_zoom', { factor }).catch(() => {}); return true },
  settings: () => invoke()?.<DesktopSettings>('desktop_settings') ?? Promise.reject(new Error('Not in the desktop app')),
  /** Watch this key for push to talk while the window is in the background (null stops). False when the shell can't. */
  pttKey: (code: string | null): Promise<boolean> => invoke()?.<boolean>('set_ptt_key', { code }).catch(() => false) ?? Promise.resolve(false),
  /** The window, taskbar and tray icon (PNG bytes); empty resets it. */
  appIcon(png: Uint8Array) { invoke()?.('set_app_icon', { png: Array.from(png) }).catch(() => {}) },
  /** Seconds since the last keyboard or mouse input anywhere on the computer. Null when the shell can't tell (older
   *  shells, browsers, Wayland). */
  inputIdle: (): Promise<number | null> => invoke()?.<number | null>('input_idle').catch(() => null) ?? Promise.resolve(null),
  /** Is OBS or XSplit running? Null when the shell can't tell (older shells, browsers). */
  streamingApps: (): Promise<boolean | null> => invoke()?.<boolean>('streaming_apps').catch(() => null) ?? Promise.resolve(null),
  /** The page's own window controls and title bar drag; resolves to whether the window is maximised. */
  window: (action: 'minimize' | 'maximize' | 'close' | 'drag' | 'state'): Promise<boolean> => invoke()?.<boolean>('window_control', { action }).catch(() => false) ?? Promise.resolve(false),
  /** App updates (shells from 0.21 on); null when the shell has no updater. */
  updateStatus: (): Promise<UpdateStatus | null> => invoke()?.<UpdateStatus>('update_status').catch(() => null) ?? Promise.resolve(null),
  checkUpdate: (): Promise<UpdateStatus | null> => invoke()?.<UpdateStatus>('check_update').catch(() => null) ?? Promise.resolve(null),
  /** Installs the downloaded update and restarts the app into it. */
  installUpdate: (): Promise<void> => invoke()?.<void>('install_update') ?? Promise.reject(new Error('Not in the desktop app')),
  /** The system Save dialog for a download about to start (shells from 0.24 on): the chosen path, null when
   *  cancelled, undefined when the shell can't ask (then the download just starts). */
  chooseDownload: (url: string, name: string): Promise<string | null | undefined> => invoke()?.<string | null>('choose_download', { url, name }).catch(() => undefined) ?? Promise.resolve(undefined),
  /** Show a file the app downloaded in its folder. */
  revealDownload: (path: string) => { invoke()?.('reveal_download', { path }).catch(() => {}) },
  setSettings: (s: { autostart?: boolean; startMinimized?: boolean; hardwareAcceleration?: boolean; closeToTray?: boolean; minimizeToTray?: boolean; updateChannel?: 'stable' | 'dev' }) => invoke()?.<DesktopSettings>('set_desktop_settings', s) ?? Promise.reject(new Error('Not in the desktop app')),
}
