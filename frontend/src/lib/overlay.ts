import { desktop, desktopBridge, isOverlay } from './desktop'
import { getPrefs, setPrefs, subscribePrefs } from './prefs'
import { useStore } from '../store'

/**
 * The desktop app's in-game overlay (Settings → Advanced → In-game overlay). While you're in a call and it's on,
 * the shell shows a small always-on-top window (`/overlay`) with who's in the call and who's talking. Speaking is
 * worked out from the audio in this window, so it's passed along on a BroadcastChannel.
 */
export const OVERLAY_CHANNEL = 'parley-overlay'
export interface OverlayMsg { speaking: Record<string, boolean>; channelId: string | null }

let shown = false
function sync() {
  const want = getPrefs().overlay && !!useStore.getState().myVoiceChannelId
  const locked = getPrefs().overlayLocked
  if (!want) { if (shown) { shown = false; void desktop.overlay(false) } return }
  shown = true
  void desktop.overlay(true, locked)
}

export function initOverlayHost() {
  if (isOverlay() || !desktopBridge()) return
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(OVERLAY_CHANNEL) : null
  const post = () => { const s = useStore.getState(); bc?.postMessage({ speaking: s.speaking, channelId: s.myVoiceChannelId } satisfies OverlayMsg) }
  bc && (bc.onmessage = (e) => { if (e.data === 'hello') post() })
  let prev: { speaking: unknown; ch: string | null } = { speaking: null, ch: null }
  useStore.subscribe((s) => {
    if (s.speaking !== prev.speaking) post()
    if (s.myVoiceChannelId !== prev.ch) sync()
    prev = { speaking: s.speaking, ch: s.myVoiceChannelId }
  })
  // Showing again is harmless (the shell reuses the window), so any settings change just re-syncs.
  subscribePrefs(sync)
}

export const toggleOverlay = () => setPrefs({ overlay: !getPrefs().overlay })
