import { Home, MessageCircle } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { showsUnread, useStore } from '../store'
import Avatar from './Avatar'
import InboxButton from './InboxButton'
import { useT } from '../lib/i18n'

let lastGuild: string | null = null
const phoneQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null
const usePhone = () => useSyncExternalStore((l) => { phoneQuery?.addEventListener('change', l); return () => phoneQuery?.removeEventListener('change', l) }, () => !!phoneQuery?.matches)

/** Phones: Discord mobile's bottom tabs (Servers, Messages, Notifications, You) under the navigation pane. */
export default function MobileTabBar() {
  return usePhone() ? <TabBar /> : null
}

function TabBar() {
  const t = useT()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [, where] = /^\/channels\/([^/]+)/.exec(pathname) ?? []
  const inDms = !where || where === '@me'
  useEffect(() => { if (where && where !== '@me') lastGuild = where }, [where])
  const firstGuild = useStore((s) => s.guildOrder.find((id) => s.guilds[id]) ?? null)
  const hasLast = useStore((s) => !!(lastGuild && s.guilds[lastGuild]))
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const dmUnread = useStore((s) => Object.keys(s.dms).filter((id) => showsUnread(s, id)).length)
  const servers = () => { const g = hasLast ? lastGuild : firstGuild; if (g) navigate(`/channels/${g}`) }
  const tab = 'flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium'
  return (
    <nav className="md:hidden shrink-0 flex items-stretch border-t border-line bg-bg-0 pb-[env(safe-area-inset-bottom)]" aria-label={t('Tabs')} data-mobile-tabs>
      <button type="button" onClick={servers} disabled={!hasLast && !firstGuild} className={`${tab} ${!inDms ? 'text-text-0' : 'text-text-2'} disabled:opacity-40`} aria-current={!inDms ? 'page' : undefined} data-mobile-tab="servers">
        <Home size={22} />{t('Servers')}
      </button>
      <button type="button" onClick={() => navigate('/channels/@me')} className={`${tab} relative ${inDms ? 'text-text-0' : 'text-text-2'}`} aria-current={inDms ? 'page' : undefined} data-mobile-tab="messages">
        <span className="relative"><MessageCircle size={22} />{dmUnread > 0 && <span className="absolute -right-2 -top-1 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-bg-0" data-mobile-dm-count>{dmUnread > 99 ? '99+' : dmUnread}</span>}</span>{t('Messages')}
      </button>
      <div className={`${tab} text-text-2`} data-mobile-tab="notifications"><InboxButton variant="tab" /></div>
      <button type="button" onClick={() => openModal({ kind: 'userSettings' })} className={`${tab} text-text-2`} data-mobile-tab="you">
        {user ? <Avatar user={user} size={22} /> : null}{t('You')}
      </button>
    </nav>
  )
}
