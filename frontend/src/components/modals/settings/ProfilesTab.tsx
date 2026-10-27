import { useShallow } from 'zustand/react/shallow'
import { Pencil } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { useStore } from '../../../store'
import ProfileCard from '../../ProfileCard'

/**
 * Settings → Profiles: your card as others see it, the way into the profile editor (the same one Edit Profile opens
 * from the user menu), and your per-server profiles. Editing happens in one place only.
 */
export default function ProfilesTab() {
  const t = useT()
  const user = useStore((s) => s.user)
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const openModal = useStore((s) => s.openModal)
  if (!user) return null
  return (
    <div className="space-y-6" data-profiles-tab>
      <h1 className="text-xl font-bold">{t('Profiles')}</h1>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="flex-1 min-w-0 space-y-4">
          <p className="text-sm text-text-2">{t('Your avatar, banner, name style, theme, nameplate, effects, badges and About Me all live in the profile editor, with a live preview.')}</p>
          <button type="button" className="btn-primary" onClick={() => openModal({ kind: 'editProfile' })} data-open-profile-editor><Pencil size={16} /> {t('Edit Profile')}</button>
          {guilds.length > 0 && (
            <div className="pt-2">
              <h3 className="label">{t('Server Profiles')}</h3>
              <p className="text-xs text-text-2 mb-2">{t('A different nickname, avatar, banner or bio in one server.')}</p>
              <div className="space-y-1">
                {guilds.map((g) => (
                  <button key={g.id} type="button" onClick={() => openModal({ kind: 'serverProfile', guildId: g.id })} className="w-full flex items-center justify-between rounded-lg bg-bg-0/40 border border-line px-3 py-2 text-sm hover:bg-bg-3" data-server-profile={g.id}>
                    <span className="truncate">{g.name}</span><span className="text-text-2 text-xs">{t('Edit')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="w-[340px] max-lg:w-full shrink-0">
          <div className="label">{t('Preview')}</div>
          <ProfileCard user={user} />
        </div>
      </div>
    </div>
  )
}
