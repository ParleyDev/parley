import { api } from './api'
import type { PrivateUser } from './types'
import { useStore } from '../store'

/** Toggle someone in one of your account lists (synced to every device). */
async function toggle(key: 'ignored_users' | 'online_alerts', id: string, done: (on: boolean) => string) {
  const s = useStore.getState()
  const cur = s.user?.[key] ?? []
  const on = !cur.includes(id)
  try {
    const u = await api.patch<PrivateUser>('/users/@me', { [key]: on ? [...cur, id] : cur.filter((x) => x !== id) })
    const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
    s.pushToast(done(on))
  } catch (e) { s.pushToast((e as Error).message, 'error') }
}

/** Ignore: their messages are collapsed and they never notify you; unlike Block, nothing changes for them. */
export const toggleIgnored = (id: string, name: string) => toggle('ignored_users', id, (on) => (on ? `Ignoring ${name}` : `Stopped ignoring ${name}`))

/** Be told when a friend comes online. */
export const toggleOnlineAlert = (id: string, name: string) => toggle('online_alerts', id, (on) => (on ? `You'll be notified when ${name} comes online` : `No more online alerts for ${name}`))

export const isIgnored = (s: { user: PrivateUser | null }, id: string) => !!s.user?.ignored_users?.includes(id)
