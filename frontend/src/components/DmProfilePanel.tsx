import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import type { UserProfile } from '../lib/types'
import ProfilePopout from './ProfilePopout'

/** Right-hand panel in a DM: the recipient's profile card, like Discord's. */
export default function DmProfilePanel({ userId }: { userId: string }) {
  const t = useT()
  const cached = useStore((s) => s.users[userId])
  const [user, setUser] = useState<UserProfile | null>(null)
  useEffect(() => { api.get<UserProfile>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])
  return (
    <aside className="w-[340px] shrink-0 bg-bg-1 border-l border-line overflow-y-auto p-4 max-md:hidden" data-dm-profile>
      {user ? <ProfilePopout user={user} onClose={() => {}} variant="panel" /> : <div className="text-sm text-text-2">{t('Loading…')}</div>}
    </aside>
  )
}
