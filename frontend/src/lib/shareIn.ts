import { registerPlugin } from '@capacitor/core'
import { isNative } from './native'
import { useStore } from '../store'

/**
 * Sharing into Parley from other apps: the phone's share sheet (the iOS app's share extension, Android's share
 * intent) hands the native shell a link, text or files; here they become a "Share to…" picker, and the chat picked
 * opens with them in its message box, to add to and send.
 */
export interface Incoming { text: string; files: File[] }

type NativeFile = { name: string; type: string; data: string }
type NativePayload = { text?: string; url?: string; title?: string; files?: NativeFile[] }
const ParleyShare = registerPlugin<{
  take(): Promise<NativePayload>
  addListener(event: 'shared', fn: () => void): Promise<{ remove: () => Promise<void> }>
}>('ParleyShare')

const fileOf = (f: NativeFile): File => {
  const bin = atob(f.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], f.name || 'file', { type: f.type || 'application/octet-stream' })
}

/** What was shared, as one message: the text, and the link on its own line unless the text already has it. */
export function incomingOf(p: NativePayload): Incoming | null {
  const text = (p.text ?? '').trim(), url = (p.url ?? '').trim()
  const body = url && !text.includes(url) ? [text, url].filter(Boolean).join('\n') : text
  const files = (p.files ?? []).map(fileOf)
  return body || files.length ? { text: body, files } : null
}

/** Open the "Share to…" picker. */
export function receiveShare(s: Incoming) {
  useStore.getState().openModal({ kind: 'shareTo', share: s })
}

// The chat picked: its message box takes this on the way in (or right away when it is already open).
let handoff: { channelId: string; share: Incoming } | null = null
export function handOff(channelId: string, share: Incoming) {
  handoff = { channelId, share }
  window.dispatchEvent(new CustomEvent('parley:share-handoff'))
}
export function takeHandoff(channelId: string): Incoming | null {
  if (handoff?.channelId !== channelId) return null
  const s = handoff.share; handoff = null
  return s
}

/** Once signed in: anything shared while the app was closed, and whatever is shared from now on. */
export function initShareIn(): () => void {
  // The same hand-over without the native shell (tests, and the web client checking a payload by hand).
  ;(window as unknown as { __parleyShareIn?: (p: NativePayload) => void }).__parleyShareIn = (p) => { const s = incomingOf(p); if (s) receiveShare(s) }
  if (!isNative()) return () => {}
  let gone = false
  const take = () => { void ParleyShare.take().then((p) => { const s = !gone && incomingOf(p ?? {}); if (s) receiveShare(s) }).catch(() => { /* an older app without the plugin */ }) }
  const sub = ParleyShare.addListener('shared', take).catch(() => null)
  take()
  return () => { gone = true; void sub.then((h) => h?.remove()) }
}
