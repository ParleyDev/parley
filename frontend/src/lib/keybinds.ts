import { useEffect, useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

/** Actions a user can bind. Combos are stored as "Ctrl+Shift+M" (modifier names + KeyboardEvent.key, upper-cased). */
export type KeybindAction = 'toggleMute' | 'toggleDeafen' | 'toggleMembers' | 'focusComposer' | 'prevChannel' | 'nextChannel' | 'openSettings' | 'jumpToDate' | 'toggleStreamer' | 'showShortcuts' | 'quickSwitcher' | 'prevUnread' | 'nextUnread' | 'prevServer' | 'nextServer' | 'toggleInbox' | 'togglePins'

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleMute: 'Toggle mute',
  toggleDeafen: 'Toggle deafen',
  toggleMembers: 'Toggle member list',
  focusComposer: 'Focus the message box',
  prevChannel: 'Previous channel',
  nextChannel: 'Next channel',
  openSettings: 'Open user settings',
  jumpToDate: 'Jump to date',
  toggleStreamer: 'Toggle Streamer Mode',
  showShortcuts: 'Show keyboard shortcuts',
  quickSwitcher: 'Quick switcher (find a channel, DM or server)',
  prevUnread: 'Previous unread channel',
  nextUnread: 'Next unread channel',
  prevServer: 'Previous server',
  nextServer: 'Next server',
  toggleInbox: 'Open the inbox',
  togglePins: 'Show pinned messages',
}

export const DEFAULT_KEYBINDS: Record<KeybindAction, string> = {
  toggleMute: 'Ctrl+Shift+M',
  toggleDeafen: 'Ctrl+Shift+D',
  toggleMembers: 'Ctrl+U',
  focusComposer: 'Ctrl+Shift+E',
  prevChannel: 'Alt+ArrowUp',
  nextChannel: 'Alt+ArrowDown',
  openSettings: 'Ctrl+,',
  jumpToDate: 'Ctrl+Shift+J',
  toggleStreamer: 'Ctrl+Shift+X',
  showShortcuts: 'Ctrl+/',
  quickSwitcher: 'Ctrl+K',
  prevUnread: 'Alt+Shift+ArrowUp',
  nextUnread: 'Alt+Shift+ArrowDown',
  prevServer: 'Ctrl+Alt+ArrowUp',
  nextServer: 'Ctrl+Alt+ArrowDown',
  toggleInbox: 'Ctrl+I',
  togglePins: 'Ctrl+P',
}

const KEY = `${STORAGE_PREFIX}keybinds`
let current: Record<KeybindAction, string> = load()
const listeners = new Set<() => void>()

function load(): Record<KeybindAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<KeybindAction, string>>
    // Ctrl+/ used to focus the message box; it now shows the shortcuts, as in Discord. Saved maps from before move along.
    if (saved.focusComposer === 'Ctrl+/' && saved.showShortcuts === undefined) delete saved.focusComposer
    return { ...DEFAULT_KEYBINDS, ...saved }
  } catch { return { ...DEFAULT_KEYBINDS } }
}
export const getKeybinds = () => current
export function setKeybind(action: KeybindAction, combo: string | null) {
  current = { ...current, [action]: combo ?? '' }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('parley:settings'))
}
export function resetKeybinds() { current = { ...DEFAULT_KEYBINDS }; try { localStorage.removeItem(KEY) } catch { /* ignore */ } listeners.forEach((l) => l()); window.dispatchEvent(new Event('parley:settings')) }
/** Replace the whole map (settings sync). */
export function replaceKeybinds(map: Partial<Record<KeybindAction, string>>) { current = { ...DEFAULT_KEYBINDS, ...map }; try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ } listeners.forEach((l) => l()) }
export function useKeybindMap() { return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getKeybinds) }

/** Normalise a KeyboardEvent to the stored combo form; null for a lone modifier press. */
export function comboOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  parts.push(k === ' ' ? 'Space' : k)
  return parts.join('+')
}

/** Human form for the settings page ("Ctrl + Shift + M"). */
export const prettyCombo = (combo: string) => combo ? combo.split('+').join(' + ') : 'Not set'

const typingIn = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)

/** Global listener: runs `handlers[action]` when its combo is pressed. Plain keys are ignored while typing; modifier combos always fire. */
export function useKeybinds(handlers: Partial<Record<KeybindAction, () => void>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A focused control that already handled the key (Ctrl+U underlines in the message box) keeps it.
      if (e.defaultPrevented) return
      const combo = comboOf(e)
      if (!combo) return
      const modified = e.ctrlKey || e.metaKey || e.altKey
      if (!modified && typingIn(document.activeElement)) return
      for (const [action, bound] of Object.entries(current) as [KeybindAction, string][]) {
        if (bound && bound === combo && handlers[action]) { e.preventDefault(); handlers[action]!(); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
