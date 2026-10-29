import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import type { UserProfile } from '../lib/types'
import ProfilePopout from './ProfilePopout'

/**
 * Right-hand panel in a DM: the recipient's profile as Discord's floating card, filling the panel's height under the
 * header with 8px around it (plus whatever the profile frame reaches past the card, reserved by FrameRoom), its
 * contents scrolling inside. Nothing in it ever scrolls the panel itself, sideways or down.
 */
export default function DmProfilePanel({ userId }: { userId: string }) {
  const t = useT()
  const cached = useStore((s) => s.users[userId])
  const [user, setUser] = useState<UserProfile | null>(null)
  useEffect(() => { api.get<UserProfile>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])
  return (
    <aside className="w-[320px] shrink-0 bg-bg-2 overflow-hidden p-2 flex flex-col phone:hidden" data-dm-profile>
      {user ? <ProfilePopout user={user} onClose={() => {}} variant="panel" /> : <div className="p-2 text-sm text-text-2">{t('Loading…')}</div>}
    </aside>
  )
}
