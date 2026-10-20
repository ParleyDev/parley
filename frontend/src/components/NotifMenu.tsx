import { Bell, BellOff, Check } from 'lucide-react'
import { LEVEL_LABELS, MUTE_OPTIONS, mutedTarget, type NotifSetting } from '../lib/notify'
import { useStore } from '../store'
import type { MenuEntry, MenuItem } from './ContextMenu'

/** "Mute X ›" / "Unmute X" and "Notification Settings ›" entries for a server, channel or DM. */
export function notifEntries(target: string, what: 'Server' | 'Channel' | 'Conversation', settings: Record<string, NotifSetting>, opts: { serverDefault?: boolean; suppress?: boolean } = {}): MenuEntry[] {
  const update = useStore.getState().updateNotif
  const cur = settings[target]
  const level = cur?.level ?? 'default'
  const muted = mutedTarget(settings, target)
  const levels: MenuItem[] = [
    ...(opts.serverDefault ? [{ label: 'Use Server Default', icon: level === 'default' ? <Check size={16} /> : <span className="w-4" />, onClick: () => update(target, { level: 'default' }) }] : []),
    ...(['all', 'mentions', 'nothing'] as const).map((l) => ({ label: LEVEL_LABELS[l], icon: level === l || (!opts.serverDefault && level === 'default' && l === 'all') ? <Check size={16} /> : <span className="w-4" />, onClick: () => update(target, { level: l }) })),
    ...(opts.suppress ? [
      { label: `${cur?.suppress_everyone ? 'Allow' : 'Suppress'} @everyone and @here`, icon: cur?.suppress_everyone ? <Check size={16} /> : <span className="w-4" />, onClick: () => update(target, { suppress_everyone: !cur?.suppress_everyone }) },
      { label: `${cur?.suppress_roles ? 'Allow' : 'Suppress'} role @mentions`, icon: cur?.suppress_roles ? <Check size={16} /> : <span className="w-4" />, onClick: () => update(target, { suppress_roles: !cur?.suppress_roles }) },
    ] : []),
  ]
  return [
    muted
      ? { label: `Unmute ${what}`, icon: <Bell size={16} />, onClick: () => update(target, { unmute: true }) }
      : { label: `Mute ${what}`, icon: <BellOff size={16} />, children: MUTE_OPTIONS.map((o) => ({ label: o.label, onClick: () => update(target, { mute_minutes: o.minutes }) })) },
    { label: 'Notification Settings', icon: <Bell size={16} />, children: levels },
  ]
}
