import { useEffect, useState } from 'react'
import { api } from './api'
import type { Channel, DmChannel, PrivateUser } from './types'
import { useStore } from '../store'

/** Where an account stands on age, and what it can do about it (`GET /users/@me/age`). Only its owner sees this. */
export interface AgeStatus {
  age_group: 'unknown' | 'teen' | 'adult'
  declared_minor: boolean
  birthday: { month: number; day: number } | null
  accept_level: 'declared' | 'attested' | 'verified'
  records: { id: string; threshold: number; level: 'declared' | 'attested' | 'verified'; provider: string; verified_at: string; expires_at: string | null; counts: boolean }[]
  request: { id: string; status: 'pending' | 'approved' | 'declined'; reply: string; created_at: string } | null
  provider_name: string | null
  can: { declare_adult: boolean; declare_minor: boolean; request: boolean; verify: boolean }
}

/**
 * The age a channel asks for after inheritance: the highest of its own, its category's (or a thread's channel's and
 * that channel's category's) and its server's. The server decides access with the same rule; this only tells the
 * client when to show the lock instead of asking for content it will be refused.
 */
export function minAgeOf(channel: Channel | DmChannel | undefined | null): number | null {
  if (!channel || !channel.guild_id) return null
  const s = useStore.getState()
  let age = s.guilds[channel.guild_id]?.min_age ?? 0
  let c: Channel | undefined = channel as Channel
  for (let i = 0; c && i < 3; i++) {
    age = Math.max(age, c.min_age ?? (c.nsfw ? 18 : 0))
    c = c.parent_id ? s.channels[c.parent_id] : undefined
  }
  return age || null
}

/** `minAgeOf`, re-read when the channel, its parents or its server change. */
export function useMinAge(channel: Channel | DmChannel | undefined | null): number | null {
  return useStore((s) => { void s.channels; void s.guilds; return minAgeOf(channel) })
}

/** Whether the signed-in account may read a place that asks for an age (the server has the final say). */
export function useLockedOut(channel: Channel | DmChannel | undefined | null): boolean {
  const need = useMinAge(channel)
  const group = useStore((s) => (s.user as PrivateUser | null)?.age_group ?? 'unknown')
  return need !== null && group !== 'adult'
}

/** The account's age standing, reloaded whenever the server says it changed. */
export function useAgeStatus(): [AgeStatus | null, (s: AgeStatus) => void] {
  const group = useStore((s) => (s.user as PrivateUser | null)?.age_group)
  const tick = useStore((s) => s.ageTick)
  const [status, setStatus] = useState<AgeStatus | null>(null)
  useEffect(() => { let live = true; api.get<AgeStatus>('/users/@me/age').then((s) => { if (live) setStatus(s) }).catch(() => {}); return () => { live = false } }, [group, tick])
  return [status, setStatus]
}
