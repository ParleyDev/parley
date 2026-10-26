import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

/**
 * What you've set for other people in calls, just for yourself (Discord's user menu): their volume (0-100%, on top of your output volume), muted
 * for you, and their camera hidden for you. Kept per browser.
 */
export interface UserAudio { volume: number; muted: boolean; hideVideo: boolean }
export const DEFAULT_USER_AUDIO: UserAudio = { volume: 100, muted: false, hideVideo: false }

const KEY = `${STORAGE_PREFIX}userAudio`
let all: Record<string, UserAudio> = load()
const listeners = new Set<() => void>()

function load(): Record<string, UserAudio> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export const userAudio = (id: string): UserAudio => ({ ...DEFAULT_USER_AUDIO, ...all[id] })
export const allUserAudio = () => all

export function setUserAudio(id: string, patch: Partial<UserAudio>) {
  const next = { ...userAudio(id), ...patch }
  const isDefault = next.volume === 100 && !next.muted && !next.hideVideo
  all = { ...all }
  if (isDefault) delete all[id]; else all[id] = next
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* storage blocked */ }
  listeners.forEach((l) => l())
}

export function onUserAudio(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }
export function useUserAudioMap(): Record<string, UserAudio> { return useSyncExternalStore(onUserAudio, allUserAudio) }
