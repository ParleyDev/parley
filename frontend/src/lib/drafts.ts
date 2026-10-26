import { STORAGE_PREFIX } from './brand'
import type { MentionItem } from '../components/MentionSuggest'

/**
 * Unsent composer text per channel, kept across channel switches and reloads, per account. `picked` remembers the
 * @mentions chosen from the menu so they still become mentions when the draft is sent later.
 */
export interface ChannelDraft { text: string; picked: Record<string, MentionItem>; at: number }

const MAX = 100
const key = (userId: string) => `${STORAGE_PREFIX}drafts.${userId}`

function load(userId: string): Record<string, ChannelDraft> {
  try { return JSON.parse(localStorage.getItem(key(userId)) || '{}') } catch { return {} }
}

export function getDraft(userId: string | undefined, channelId: string): ChannelDraft | null {
  if (!userId) return null
  return load(userId)[channelId] ?? null
}

export function saveDraft(userId: string | undefined, channelId: string, text: string, picked: Record<string, MentionItem>) {
  if (!userId) return
  const all = load(userId)
  if (text.trim()) all[channelId] = { text, picked, at: Date.now() }
  else delete all[channelId]
  // Keep the newest drafts only, so storage can't grow without bound.
  const ids = Object.keys(all)
  if (ids.length > MAX) ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - MAX).forEach((id) => delete all[id])
  try { localStorage.setItem(key(userId), JSON.stringify(all)) } catch { /* storage full or blocked */ }
}
