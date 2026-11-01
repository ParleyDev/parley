import { ArrowLeft, ArrowRight, Inbox, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { usePrefs } from '../lib/prefs'
import { usePhone } from '../lib/swipe'
import { colorFor, initials } from '../lib/format'
import { dmName, isGroup } from '../lib/dm'
import { useT } from '../lib/i18n'
import Avatar from './Avatar'
import GroupIcon from './GroupIcon'
import InboxButton from './InboxButton'

/** History buttons can't know whether there is a page to go to outside Chromium (Navigation API); assume there is. */
const nav = (window as unknown as { navigation?: { canGoBack?: boolean; canGoForward?: boolean } }).navigation

/**
 * Discord's title bar: a slim strip across the top of every view on wide screens with back/forward, where you are
 * (the server, the DM or Friends) and the inbox. Paints nothing of its own so themes run through it. Settings →
 * Appearance → Show title bar; never on phones.
 */
export default function TitleBar() {
  const on = usePrefs().titleBar
  const phone = usePhone()
  if (!on || phone) return null
  return <Bar />
}

function Bar() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [, , first, second] = pathname.split('/')
  const guild = useStore((s) => (first && first !== '@me' ? s.guilds[first] : undefined))
  const dm = useStore((s) => (first === '@me' && second && second !== 'requests' ? s.dms[second] : undefined))
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)

  let icon: ReactNode = <Users size={16} />, title = t('Friends')
  if (guild) {
    icon = <span className="h-5 w-5 shrink-0 overflow-hidden rounded-md flex items-center justify-center text-[9px] font-bold text-white" style={{ background: guild.icon_url ? undefined : colorFor(guild.id) }}>{guild.icon_url ? <img src={guild.icon_url} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(guild.name)}</span>
    title = guild.name
  } else if (dm) {
    const other = !isGroup(dm) && dm.recipients[0] ? { ...dm.recipients[0], ...users[dm.recipients[0].id] } : undefined
    icon = isGroup(dm) ? <GroupIcon dm={dm} size={20} /> : other ? <Avatar user={other} size={20} /> : null
    title = dmName(dm, users, notes)
  } else if (second === 'requests') {
    icon = <Inbox size={16} />; title = t('Message Requests')
  } else if (first === '@me' && second) {
    title = t('Direct Messages')
  }
  const arrow = 'h-6 w-6 rounded-md flex items-center justify-center text-text-2 hover:bg-white/10 hover:text-text-0 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="relative z-30 shrink-0 h-9 flex items-center px-2 text-sm" data-title-bar>
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => navigate(-1)} disabled={nav?.canGoBack === false} title={t('Back')} aria-label={t('Back')} className={arrow} data-title-back><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => navigate(1)} disabled={nav?.canGoForward === false} title={t('Forward')} aria-label={t('Forward')} className={arrow} data-title-forward><ArrowRight size={16} /></button>
      </div>
      <div className="pointer-events-none absolute inset-x-28 inset-y-0 flex items-center justify-center gap-2 font-semibold text-text-0" data-title-bar-place>
        <span className="shrink-0 flex text-text-1">{icon}</span><span className="truncate" data-title-bar-name>{title}</span>
      </div>
      <div className="ml-auto flex items-center" data-title-bar-actions><InboxButton inTitleBar /></div>
    </div>
  )
}
