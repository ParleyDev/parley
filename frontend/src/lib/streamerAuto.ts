import { desktop, desktopBridge } from './desktop'
import { getPrefs, setPrefs } from './prefs'

/**
 * Streamer Mode → "Automatically enable when OBS or XSplit is running" (desktop app only: a browser can't see other
 * programs). Acts on changes only: OBS starting turns Streamer Mode on, OBS quitting turns it back off if this did
 * the turning on, and a manual toggle in between is left alone.
 */
const EVERY_MS = 10_000
let last: boolean | null = null
let ours = false

async function check() {
  if (!getPrefs().streamerAuto) { last = null; ours = false; return }
  const running = await desktop.streamingApps()
  if (running === null || running === last) return
  last = running
  if (running && !getPrefs().streamer) { ours = true; setPrefs({ streamer: true }) }
  else if (!running && ours) { ours = false; if (getPrefs().streamer) setPrefs({ streamer: false }) }
}

export function initStreamerAuto() {
  if (!desktopBridge()) return
  void check()
  setInterval(() => { void check() }, EVERY_MS)
}

/** Test hook: run a check now. */
;(window as unknown as { __parleyStreamerCheck?: () => Promise<void> }).__parleyStreamerCheck = check
