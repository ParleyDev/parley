/**
 * The chrome around the app follows the theme: the browser's theme-color (address bar, installed app title bar), the
 * phone's status bar (light or dark icons, and its colour on Android) and the desktop app's window theme and
 * background (Windows and macOS title bars follow the window theme). Called whenever the theme changes.
 */
let last = ''
export function themeShells(base: 'light' | 'dark', color: string) {
  const key = `${base}|${color}`
  if (key === last || typeof document === 'undefined') return
  last = key
  const solid = /^#[0-9a-f]{6}$/i.test(color) ? color : base === 'dark' ? '#1e1f22' : '#f2f3f5'
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
  meta.content = solid
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
  if (cap?.isNativePlatform?.()) {
    void import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      void StatusBar.setStyle({ style: base === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
      if (cap.getPlatform?.() === 'android') void StatusBar.setBackgroundColor({ color: solid }).catch(() => {})
    }).catch(() => {})
  }
  const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke
  if (invoke) void invoke('set_theme', { dark: base === 'dark', color: solid }).catch(() => {})
}
