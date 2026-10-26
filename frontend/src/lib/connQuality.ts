import { useSyncExternalStore } from 'react'
import { qualityOf } from './audioProfile'
import { voice } from './voice'
import { useStore } from '../store'

/** Per-person connection quality in the current call, sampled every 3 s while you're in one. */
let map: Record<string, 'good' | 'ok' | 'bad'> = {}
const listeners = new Set<() => void>()
async function sample() {
  if (!useStore.getState().myVoiceChannelId) { if (Object.keys(map).length) { map = {}; listeners.forEach((l) => l()) } return }
  try {
    const next: typeof map = {}
    for (const st of await voice.audioStats()) { const q = qualityOf(st); if (q) next[st.userId] = q }
    map = next; listeners.forEach((l) => l())
  } catch { /* closed */ }
}
if (typeof window !== 'undefined') setInterval(sample, 3000)

export function useConnQuality(userId: string): 'good' | 'ok' | 'bad' | undefined {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => map[userId])
}
