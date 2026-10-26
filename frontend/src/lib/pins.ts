import { api } from './api'
import type { PrivateUser } from './types'
import { useStore } from '../store'

/** Pin or unpin a channel or DM to the top of its list; saved on the account, so every device follows. */
export async function togglePinned(id: string) {
  const s = useStore.getState()
  const cur = s.user?.pinned_channels ?? []
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  try {
    const u = await api.patch<PrivateUser>('/users/@me', { pinned_channels: next })
    const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
  } catch (e) { s.pushToast((e as Error).message, 'error') }
}
