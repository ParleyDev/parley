import { useSyncExternalStore } from 'react'
import { api } from './api'

/** A badge an instance's admins made (routes/custom_badges.rs); profiles name it as `custom:<id>`. */
export interface CustomBadge { id: string; name: string; description: string; emoji: string; icon_url: string | null; color: string; position: number }

let list: CustomBadge[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

/** The whole catalog (on READY, and from BADGES_UPDATE when an admin changes it). */
export function setCustomBadges(next: CustomBadge[]) { list = next; emit() }
export async function loadCustomBadges() { try { setCustomBadges(await api.get<CustomBadge[]>('/badges')) } catch { /* profiles show built-in badges only */ } }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useCustomBadges = () => useSyncExternalStore(subscribe, () => list)

export const CUSTOM_BADGE = 'custom:'
export const customBadgeId = (b: string) => (b.startsWith(CUSTOM_BADGE) ? b.slice(CUSTOM_BADGE.length) : null)
/** What a badge's tooltip says: its name, then why people have it. */
export const customBadgeTip = (b: Pick<CustomBadge, 'name' | 'description'>) => (b.description ? `${b.name}: ${b.description}` : b.name)
