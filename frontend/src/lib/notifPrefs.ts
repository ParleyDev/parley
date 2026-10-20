import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

/** Every sound the app can make, each with its own switch (Settings → Notifications → Sounds). */
export type SoundKey =
  | 'message' | 'mention'
  | 'deafen' | 'undeafen' | 'mute' | 'unmute' | 'disconnect'
  | 'ptt_activate' | 'ptt_deactivate'
  | 'user_join' | 'user_leave'
  | 'incoming_ring' | 'outgoing_ring'
  | 'stream_started' | 'stream_stopped'
  | 'invite_speak'

export const SOUND_LABELS: { key: SoundKey; label: string; hint?: string }[] = [
  { key: 'message', label: 'Message', hint: 'A new message you would be notified about, while you are not looking at it' },
  { key: 'mention', label: 'Mention', hint: 'Someone mentions you' },
  { key: 'deafen', label: 'Deafen' },
  { key: 'undeafen', label: 'Undeafen' },
  { key: 'mute', label: 'Mute' },
  { key: 'unmute', label: 'Unmute' },
  { key: 'disconnect', label: 'Voice Disconnected', hint: 'You were dropped from a call or voice channel' },
  { key: 'ptt_activate', label: 'PTT Activate' },
  { key: 'ptt_deactivate', label: 'PTT Deactivate' },
  { key: 'user_join', label: 'User Join', hint: 'Someone joins your call or voice channel (and when you join)' },
  { key: 'user_leave', label: 'User Leave', hint: 'Someone leaves your call or voice channel (and when you leave)' },
  { key: 'incoming_ring', label: 'Incoming Ring', hint: 'Rings while an incoming call banner is showing, up to 45 seconds' },
  { key: 'outgoing_ring', label: 'Outgoing Ring', hint: 'Rings while you wait for the other side to pick up' },
  { key: 'stream_started', label: 'Stream Started' },
  { key: 'stream_stopped', label: 'Stream Stopped' },
  { key: 'invite_speak', label: 'Invited to Speak', hint: 'A stage moderator invites you to the stage' },
]

export type Tts = 'never' | 'current' | 'all'
export interface NotifPrefs {
  /** Show desktop (browser) notifications for messages that would notify you, when the tab is hidden. */
  desktop: boolean
  sounds: Record<SoundKey, boolean>
  /** Volume of every sound, 0..100 (%). */
  volume: number
  /** Unread badge: a count on the tab icon (and the app icon where supported). */
  badge: boolean
  /** Read notifying messages aloud: never, only in the channel you are looking at, or all of them. */
  tts: Tts
  /** A reply to one of your messages counts as a mention. */
  replyMentions: boolean
}

const allOn = (): Record<SoundKey, boolean> => Object.fromEntries(SOUND_LABELS.map((s) => [s.key, true])) as Record<SoundKey, boolean>
export const DEFAULT_NOTIF_PREFS: NotifPrefs = { desktop: true, sounds: allOn(), volume: 100, badge: true, tts: 'never', replyMentions: true }
const KEY = `${STORAGE_PREFIX}notifications`

function load(): NotifPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // Before this existed the ringtone switch lived in voice settings; carry it over.
      const prefs = { ...DEFAULT_NOTIF_PREFS, sounds: allOn() }
      try { const v = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}voiceSettings`) ?? '{}'); if (v.ringtone === false) prefs.sounds.incoming_ring = false } catch { /* ignore */ }
      return prefs
    }
    const p = JSON.parse(raw) as Partial<NotifPrefs>
    return { desktop: p.desktop !== false, sounds: { ...allOn(), ...(p.sounds ?? {}) }, volume: typeof p.volume === 'number' ? Math.max(0, Math.min(100, p.volume)) : 100,
      badge: p.badge !== false, tts: p.tts === 'current' || p.tts === 'all' ? p.tts : 'never', replyMentions: p.replyMentions !== false }
  } catch { return { ...DEFAULT_NOTIF_PREFS, sounds: allOn() } }
}

let current: NotifPrefs = load()
const listeners = new Set<() => void>()

export function getNotifPrefs(): NotifPrefs { return current }
export function setNotifPrefs(patch: Partial<NotifPrefs>) {
  current = { ...current, ...patch, sounds: { ...current.sounds, ...(patch.sounds ?? {}) } }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
export function setSound(key: SoundKey, on: boolean) { setNotifPrefs({ sounds: { ...current.sounds, [key]: on } }) }
export function useNotifPrefs(): NotifPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
}
