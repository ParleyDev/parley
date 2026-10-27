import { create } from 'zustand'
import { api } from './api'
import { useStore } from '../store'

/**
 * Activities in calls (backend: routes/activities.rs): which are running in each call, and which one this client has
 * open. The open activity's page talks to us through the SDK (public/activities/sdk.js); its state and message
 * events arrive on the socket and are handed to the page by `onSessionEvent`.
 */
export interface CallActivity {
  id: string; channel_id: string; key: string; name: string; url: string; app_id?: string | null; icon_url?: string | null
  started_by: string; created_at: string; participants: string[]
}
export interface CatalogEntry { key: string; name: string; description: string; url: string; builtin: boolean; app_id?: string; icon_url?: string | null }

interface State { byChannel: Record<string, CallActivity[]>; open: string | null }
export const useActivities = create<State>(() => ({ byChannel: {}, open: null }))
const EMPTY: CallActivity[] = []
export const useCallActivities = (channelId: string) => useActivities((s) => s.byChannel[channelId] ?? EMPTY)

export async function loadActivities(channelId: string) {
  const list = await api.get<CallActivity[]>(`/channels/${channelId}/activities`).catch(() => null)
  if (list) useActivities.setState((s) => ({ byChannel: { ...s.byChannel, [channelId]: list } }))
}

/** CALL_ACTIVITY_UPDATE: a session started, changed who is in it, or ended. */
export function applyActivityUpdate(d: CallActivity | { id: string; channel_id: string; ended: true }) {
  useActivities.setState((s) => {
    const cur = s.byChannel[d.channel_id] ?? EMPTY
    const next = 'ended' in d ? cur.filter((a) => a.id !== d.id) : cur.some((a) => a.id === d.id) ? cur.map((a) => (a.id === d.id ? d : a)) : [...cur, d]
    const me = useStore.getState().user?.id
    // Closed here when it ended, or when we were taken out of it (left on another device, left the call).
    const gone = s.open === d.id && ('ended' in d || (!!me && !d.participants.includes(me)))
    return { byChannel: { ...s.byChannel, [d.channel_id]: next }, open: gone ? null : s.open }
  })
}

export async function startActivity(channelId: string, key: string): Promise<CallActivity> {
  const s = await api.post<CallActivity>(`/channels/${channelId}/activities`, { key })
  applyActivityUpdate(s)
  useActivities.setState({ open: s.id })
  return s
}

export async function leaveActivity(id: string) {
  useActivities.setState({ open: null })
  await api.delete(`/activities/${id}/participants/@me`).catch(() => {})
}

export type SessionEvent = { t: 'state' | 'message'; id: string; data: unknown; user_id: string }
const listeners = new Set<(e: SessionEvent) => void>()
export function onSessionEvent(f: (e: SessionEvent) => void) { listeners.add(f); return () => { listeners.delete(f) } }
export function dispatchSessionEvent(e: SessionEvent) { listeners.forEach((f) => f(e)) }

// Leaving the call leaves its activities (the server does the same).
useStore.subscribe((s, prev) => { if (prev.myVoiceChannelId && s.myVoiceChannelId !== prev.myVoiceChannelId) useActivities.setState({ open: null }) })
