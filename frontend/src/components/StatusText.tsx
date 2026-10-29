import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { renderInline } from '../lib/markdown'
import { shownStatus } from './Avatar'
import { useEffect, useState } from 'react'
import { emojiGroupsSync, expandShortcodes, loadEmojiGroups } from '../lib/emoji'

/** Custom status text with `:shortcode:` emoji turned into emoji (the set loads on first use). */
export function StatusEmojiText({ text }: { text: string }) {
  const [, ready] = useState(!!emojiGroupsSync())
  useEffect(() => { if (!emojiGroupsSync() && text.includes(':')) void loadEmojiGroups().then(() => ready(true)) }, [text])
  return <>{renderInline(expandShortcodes(text), { noLinks: true })}</>
}

/**
 * The line under a person's name (Friends, the member list), like Discord's: their custom status (emoji rendered) when
 * they have one and are online, else what their dot means: Online, Idle or Do Not Disturb, or Offline.
 */
export default function StatusText({ userId, fallback, online, className = '' }: { userId: string; fallback?: string; online: boolean; className?: string }) {
  const t = useT()
  const status = useStore((s) => shownStatus(s.users[userId]?.status, !!s.idle[userId]))
  const custom = useStore((s) => s.users[userId]?.custom_status) ?? fallback ?? ''
  const shown = online && status !== 'invisible'
  if (shown && custom) return <span className={`block truncate ${className}`} title={custom} data-status-text="custom"><StatusEmojiText text={custom} /></span>
  const label = !shown ? t('Offline') : status === 'idle' ? t('Idle') : status === 'dnd' ? t('Do Not Disturb') : t('Online')
  return <span className={`block truncate ${className}`} data-status-text={!shown ? 'offline' : status ?? 'online'}>{label}</span>
}
