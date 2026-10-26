import { api } from './api'
import { STORAGE_PREFIX } from './brand'
import { getAppearance, setAppearance, type Appearance } from './appearance'
import { getKeybinds, replaceKeybinds } from './keybinds'
import { getNotifPrefs, setNotifPrefs, type NotifPrefs } from './notifPrefs'
import { getPrefs, setPrefs, type ClientPrefs } from './prefs'

/**
 * Settings sync: appearance, chat/accessibility preferences, notification sounds and keybinds are saved on the account
 * (a blob with a revision stamp) so every device follows. Newer wins; turning sync off keeps this browser's own.
 */
export interface SyncedSettings { rev: number; appearance?: Partial<Appearance>; prefs?: Partial<ClientPrefs>; notif?: Partial<NotifPrefs>; keybinds?: Record<string, string> }

const REV = `${STORAGE_PREFIX}settingsRev`
const ON = `${STORAGE_PREFIX}syncSettings`
const localRev = () => { try { return Number(localStorage.getItem(REV) ?? '0') } catch { return 0 } }
const setLocalRev = (r: number) => { try { localStorage.setItem(REV, String(r)) } catch { /* ignore */ } }
export const syncEnabled = () => { try { return localStorage.getItem(ON) !== '0' } catch { return true } }
export function setSyncEnabled(on: boolean) { try { localStorage.setItem(ON, on ? '1' : '0') } catch { /* ignore */ } if (on) void push() }

let applying = false
let timer: ReturnType<typeof setTimeout> | null = null

async function push() {
  if (!syncEnabled()) return
  const blob: SyncedSettings = { rev: Date.now(), appearance: getAppearance(), prefs: getPrefs(), notif: getNotifPrefs(), keybinds: getKeybinds() }
  setLocalRev(blob.rev)
  try { await api.put('/users/@me/client-settings', blob) } catch { /* next change retries */ }
}

/** Apply the account's settings when they're newer than what this browser last saw. */
export function receive(s: Partial<SyncedSettings> | null | undefined) {
  if (!s || !syncEnabled() || typeof s.rev !== 'number') return
  if (s.rev <= localRev()) { if (s.rev < localRev()) void push(); return }
  applying = true
  try {
    if (s.appearance) setAppearance(s.appearance)
    if (s.prefs) setPrefs(s.prefs)
    if (s.notif) setNotifPrefs(s.notif)
    if (s.keybinds) replaceKeybinds(s.keybinds)
    setLocalRev(s.rev)
  } finally { applying = false }
}

/** Once at boot: push local changes (debounced) as they happen. */
export function installSettingsSync() {
  window.addEventListener('parley:settings', () => {
    if (applying || !syncEnabled()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void push(), 800)
  })
}
