import { api } from './api'
import { useStore } from '../store'
import type { PrivateUser } from './types'

/** Start a "Try Parley" guest session: a throwaway account already in the instance's demo server. Returns its id. */
export async function startGuest(): Promise<string> {
  const res = await api.post<{ token: string; user: PrivateUser; guild_id: string }>('/auth/guest', {})
  useStore.getState().setAuth(res.token, res.user)
  return res.guild_id
}
