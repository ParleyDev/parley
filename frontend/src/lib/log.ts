import { STORAGE_PREFIX } from './brand'

/**
 * Client log ring buffer for Settings → Advanced → "Download logs". Errors and warnings are always kept;
 * with debug logging on, connection and voice events are too.
 */
export interface LogEntry { t: string; level: 'error' | 'warn' | 'info'; msg: string }
const MAX = 500
const buf: LogEntry[] = []
let debug = false
try { debug = localStorage.getItem(`${STORAGE_PREFIX}debugLog`) === '1' } catch { /* ignore */ }

export function setDebugLogging(on: boolean) { debug = on; try { localStorage.setItem(`${STORAGE_PREFIX}debugLog`, on ? '1' : '0') } catch { /* ignore */ } log('info', `debug logging ${on ? 'on' : 'off'}`) }
export const debugLogging = () => debug

function fmt(args: unknown[]): string {
  return args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ').slice(0, 2000)
}

export function log(level: LogEntry['level'], ...args: unknown[]) {
  if (level === 'info' && !debug) return
  buf.push({ t: new Date().toISOString(), level, msg: fmt(args) })
  if (buf.length > MAX) buf.shift()
}
export const entries = () => buf.slice()

/** The whole buffer as text, with a header a reader can act on. */
export function dumpLogs(): string {
  const head = [`parley client logs · ${new Date().toISOString()}`, `url: ${location.href}`, `ua: ${navigator.userAgent}`, `debug: ${debug}`, ''].join('\n')
  return head + buf.map((e) => `${e.t} [${e.level}] ${e.msg}`).join('\n') + '\n'
}

export function downloadLogs() {
  const blob = new Blob([dumpLogs()], { type: 'text/plain' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `parley-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`; a.click(); URL.revokeObjectURL(url)
}

/** Hook the browser's error channels once. */
let hooked = false
export function initLog() {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  const origError = console.error.bind(console), origWarn = console.warn.bind(console)
  console.error = (...a: unknown[]) => { log('error', ...a); origError(...a) }
  console.warn = (...a: unknown[]) => { log('warn', ...a); origWarn(...a) }
  window.addEventListener('error', (e) => log('error', 'uncaught', e.message, `${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => log('error', 'unhandled rejection', e.reason))
  log('info', 'client started')
}
