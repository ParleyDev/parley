import { useSyncExternalStore } from 'react'
import { desktop, desktopBridge, type UpdateStatus } from './desktop'

/** Where desktop releases are published (the shell's updater reads the same releases). */
export const RELEASES = 'https://github.com/ParleyDev/parley/releases/latest'

/** Is version a newer than b? Plain x.y.z, anything after - or + ignored. */
export function newer(a: string, b: string): boolean {
  const n = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => parseInt(x, 10) || 0)
  const [x, y] = [n(a), n(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

export type DesktopUpdate =
  | { kind: 'none' }
  /** This shell updates itself: its updater's status. */
  | { kind: 'shell'; status: UpdateStatus }
  /** A shell from before the updater, with a newer app out: it has to be downloaded. */
  | { kind: 'download'; version: string; current: string }

let latestRelease: Promise<string | null> | null = null
const latestTag = () => (latestRelease ??= fetch('https://api.github.com/repos/ParleyDev/parley/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : null)).then((j) => (typeof j?.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : null)).catch(() => null))

// One poller for the whole page: the title bar, the banner and Settings all see the same state.
let current: DesktopUpdate = { kind: 'none' }
const subs = new Set<() => void>()
const publish = (u: DesktopUpdate) => { current = u; subs.forEach((f) => f()) }
let timer = 0, started = false
async function poll() {
  window.clearTimeout(timer)
  const s = await desktop.updateStatus()
  if (s) {
    publish({ kind: 'shell', status: s })
    timer = window.setTimeout(poll, s.state === 'checking' || s.state === 'downloading' ? 1000 : 60_000)
    return
  }
  // An older shell without an updater: compare its version with the latest release.
  const version = await desktop.settings().then((x) => x.version).catch(() => null)
  const latest = await latestTag()
  if (version && latest && newer(latest, version)) publish({ kind: 'download', version: latest, current: version })
}
const subscribe = (f: () => void) => {
  subs.add(f)
  if (!started && desktopBridge()) { started = true; void poll() }
  return () => { subs.delete(f) }
}

/** The desktop app's update state, refreshed every minute (every second while checking or downloading). */
export function useDesktopUpdate(): DesktopUpdate {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** Settings → Check for updates. */
export async function checkForUpdate() {
  const s = await desktop.checkUpdate()
  if (s) publish({ kind: 'shell', status: s })
  void poll()
}
