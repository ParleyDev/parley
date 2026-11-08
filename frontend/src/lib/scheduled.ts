import { create } from 'zustand'
import { api } from './api'
import { locale, t } from './i18n'
import type { Message } from './types'

/** A message waiting to be sent by the server at `send_at` (Inbox → Scheduled). */
export interface Scheduled {
  id: string
  channel_id: string
  guild_id: string | null
  content: string
  reply_to: string | null
  attachments: { id: string; filename: string; content_type: string }[]
  send_at: string
  /** 'failed' keeps it in the list with `error` until it is edited, retried or deleted. */
  status: 'pending' | 'sending' | 'failed'
  error: string | null
  created_at: string
}

/** Queued at once, for everyone (Discord's Nitro limit; Parley has no paid tier). */
export const MAX_SCHEDULED = 30

interface State {
  list: Scheduled[] | null
  load: () => Promise<void>
  upsert: (s: Scheduled) => void
  drop: (id: string) => void
}

const byTime = (a: Scheduled, b: Scheduled) => a.send_at.localeCompare(b.send_at)

/** Your scheduled messages, kept current from the gateway on every device. */
export const useScheduled = create<State>((set) => ({
  list: null,
  load: async () => { try { set({ list: (await api.get<Scheduled[]>('/users/@me/scheduled-messages')).sort(byTime) }) } catch { /* keep what we had */ } },
  upsert: (s) => set((st) => ({ list: [...(st.list ?? []).filter((x) => x.id !== s.id), s].sort(byTime) })),
  drop: (id) => set((st) => ({ list: (st.list ?? []).filter((x) => x.id !== id) })),
}))

export async function scheduleMessage(channelId: string, body: { content: string; send_at: string; reply_to?: string | null; attachment_ids?: string[] }) {
  const s = await api.post<Scheduled>(`/channels/${channelId}/scheduled-messages`, body)
  useScheduled.getState().upsert(s)
  return s
}
export async function updateScheduled(id: string, body: { content?: string; send_at?: string }) {
  const s = await api.patch<Scheduled>(`/users/@me/scheduled-messages/${id}`, body)
  useScheduled.getState().upsert(s)
  return s
}
export async function deleteScheduled(id: string) {
  await api.delete(`/users/@me/scheduled-messages/${id}`)
  useScheduled.getState().drop(id)
}
export async function sendScheduledNow(id: string) {
  try {
    const m = await api.post<Message>(`/users/@me/scheduled-messages/${id}/send`)
    useScheduled.getState().drop(id)
    return m
  } finally {
    void useScheduled.getState().load()
  }
}

/** Presets like Discord's: soon, later today, tomorrow morning, next week. Times already past for today are left out. */
export function schedulePresets(now = new Date()): { id: string; label: string; at: Date }[] {
  const at = (days: number, h: number) => { const d = new Date(now); d.setDate(now.getDate() + days); d.setHours(h, 0, 0, 0); return d }
  const monday = at((((8 - now.getDay()) % 7) || 7), 9)
  const out = [
    { id: '30m', label: t('In 30 minutes'), at: new Date(now.getTime() + 30 * 60_000) },
    { id: '1h', label: t('In 1 hour'), at: new Date(now.getTime() + 3600_000) },
    { id: '3h', label: t('In 3 hours'), at: new Date(now.getTime() + 3 * 3600_000) },
    { id: 'tonight', label: t('Tonight'), at: at(0, 20) },
    { id: 'tomorrow', label: t('Tomorrow morning'), at: at(1, 9) },
    { id: 'monday', label: t('Monday morning'), at: monday },
  ]
  // Tonight only while it's still a while off; Monday only when it isn't tomorrow.
  return out.filter((p) => (p.id !== 'tonight' || p.at.getTime() - now.getTime() > 3 * 3600_000) && (p.id !== 'monday' || now.getDay() !== 0))
}

/** "Today at 9:00 PM", "Tomorrow at 9:00 AM", "Mon, Nov 9 at 9:00 AM". */
export function whenLabel(d: Date, now = new Date()) {
  const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  if (diff === 0) return t('Today at {time}', { time })
  if (diff === 1) return t('Tomorrow at {time}', { time })
  const date = d.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return t('{date} at {time}', { date, time })
}
