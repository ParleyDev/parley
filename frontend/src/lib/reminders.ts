import { api } from './api'
import { useStore } from '../store'
import { t } from './i18n'

/** "Remind me" presets, as in Discord's Save for Later. */
export function remindPresets(now = new Date()): { label: string; at: Date }[] {
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(9, 0, 0, 0)
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7)); monday.setHours(9, 0, 0, 0)
  return [
    { label: t('In 20 minutes'), at: new Date(now.getTime() + 20 * 60_000) },
    { label: t('In 1 hour'), at: new Date(now.getTime() + 3600_000) },
    { label: t('In 3 hours'), at: new Date(now.getTime() + 3 * 3600_000) },
    { label: t('Tomorrow'), at: tomorrow },
    { label: t('Next week'), at: monday },
  ]
}

export const remindLabel = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** Bookmark the message (if it is not already) and set when to be reminded about it; null clears the reminder. */
export async function setReminder(messageId: string, at: Date | null): Promise<string | null> {
  const s = useStore.getState()
  if (!s.bookmarks[messageId]) { await api.put(`/users/@me/bookmarks/${messageId}`); s.setBookmark(messageId, true) }
  const r = await api.patch<{ remind_at: string | null }>(`/users/@me/bookmarks/${messageId}`, { remind_at: at ? at.toISOString() : null })
  return r.remind_at
}
