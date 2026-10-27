import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { relativeTime } from '../../../lib/ua'
import { t, useT } from '../../../lib/i18n'

interface Row { id: string; actor_id: string | null; actor_name: string; action: string; target_kind: string; target_id: string | null; target_name: string; details: Record<string, unknown>; created_at: string }

const LABELS: Record<string, string> = {
  'guild.update': 'updated the server', 'guild.badge_update': 'changed the README badge of', 'guild.transfer': 'transferred ownership to',
  'channel.create': 'created channel', 'channel.update': 'edited channel', 'channel.delete': 'deleted channel', 'channel.overwrite': 'changed permissions in', 'channel.overwrite_delete': 'removed a permission overwrite in',
  'role.create': 'created role', 'role.update': 'edited role', 'role.delete': 'deleted role',
  'member.kick': 'kicked', 'member.ban': 'banned', 'member.unban': 'unbanned', 'member.timeout': 'timed out', 'member.timeout_clear': 'removed the timeout of', 'member.update': 'updated member',
  'message.delete': 'deleted a message by', 'message.bulk_delete': 'bulk-deleted messages in', 'emoji.create': 'added emoji', 'emoji.update': 'renamed emoji', 'emoji.delete': 'deleted emoji',
  'sticker.create': 'added sticker', 'sticker.update': 'edited sticker', 'sticker.delete': 'deleted sticker',
  'discovery.submit': 'submitted to Discover', 'discovery.withdraw': 'withdrew from Discover',
  'invite.delete': 'revoked invite', 'invite.vanity_create': 'claimed vanity link', 'invite.vanity_delete': 'removed vanity link',
}

// Any action can carry a reason: typed in a kick or ban dialog, or sent by a bot in X-Audit-Log-Reason.
const describe = (r: Row): string => {
  const d = r.details ?? {}
  const reason = typeof d.reason === 'string' && d.reason ? t('reason: {reason}', { reason: d.reason }) : ''
  return [what(r.action, d), reason].filter(Boolean).join(' · ')
}

const what = (action: string, d: Record<string, unknown>): string => {
  switch (action) {
    case 'member.timeout': return d.minutes === 1 ? t('for 1 minute') : t('for {n} minutes', { n: String(d.minutes) })
    case 'member.ban': return typeof d.messages_deleted === 'number' && d.messages_deleted > 0 ? (d.messages_deleted === 1 ? t('deleted 1 message') : t('deleted {n} messages', { n: d.messages_deleted })) : ''
    case 'message.bulk_delete': return d.count === 1 ? t('1 message') : t('{n} messages', { n: String(d.count) })
    case 'member.update': return [Array.isArray(d.roles) ? t('roles: {list}', { list: (d.roles as string[]).join(', ') || t('none') }) : '', 'nickname' in d ? t('nickname: {name}', { name: String(d.nickname ?? t('cleared')) }) : ''].filter(Boolean).join(' · ')
    case 'message.delete': return t('in #{channel}', { channel: String(d.channel) })
    case 'guild.update': case 'guild.badge_update': case 'role.update': case 'channel.update': return Object.entries(d).filter(([k]) => k !== 'reason').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
    case 'channel.overwrite': return t('{kind} overwrite · allow {allow} · deny {deny}', { kind: String(d.kind), allow: String(d.allow), deny: String(d.deny) })
    case 'discovery.submit': return t('category: {category}', { category: String(d.category) })
    default: return ''
  }
}

const ACTION_FILTERS: [string, string][] = [
  ['', 'All actions'], ['guild.', 'Server settings'], ['channel.', 'Channels'], ['role.', 'Roles'], ['member.', 'Members'],
  ['member.ban', 'Bans'], ['member.kick', 'Kicks'], ['member.timeout', 'Timeouts'], ['message.', 'Messages'], ['invite.', 'Invites'],
  ['emoji.', 'Emoji'], ['sticker.', 'Stickers'],
]

/** Server Settings → Audit Log: who changed what, newest first. */
export default function AuditLogTab({ guildId }: { guildId: string }) {
  useT()
  const guild = useStore((s) => s.guilds[guildId])
  const [q, setQ] = useState('')
  // Filters: whose actions, and which kind (a family like "member." or one action).
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const members = useStore((s) => s.members[guildId])
  const actors = Object.values(members ?? {}).sort((a, b) => (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))
  const [rows, setRows] = useState<Row[] | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (before?: string) => {
    setBusy(true)
    try {
      const page = await api.get<Row[]>(`/guilds/${guildId}/audit?q=${encodeURIComponent(q)}${actor ? `&actor=${actor}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}${before ? `&before=${before}` : ''}`)
      setRows((r) => before && r ? [...r, ...page] : page); setDone(page.length < 100)
    } catch { setRows((r) => r ?? []) } finally { setBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => load(), 150); return () => clearTimeout(timer) }, [guildId, q, actor, action]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!guild) return null
  return (
    <div data-guild-audit>
      <h1 className="text-xl font-bold">{t('Audit Log')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Moderation and settings changes in {name}, newest first.', { name: guild.name })}</p>
      <div className="mt-4 mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <input className="input pl-9" placeholder={t('Filter by member, action or target')} value={q} onChange={(e) => setQ(e.target.value)} data-guild-audit-search />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <select className="input w-auto" value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t('Filter by user')} data-audit-filter-user>
          <option value="">{t('All users')}</option>
          {actors.map((m) => <option key={m.user_id} value={m.user_id}>{m.nickname ?? m.display_name}</option>)}
        </select>
        <select className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('Filter by action')} data-audit-filter-action>
          {ACTION_FILTERS.map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}
        </select>
      </div>
      {rows && rows.length === 0 && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2" data-guild-audit-empty>{busy ? t('Loading…') : t('Nothing logged yet.')}</div>}
      <div className="divide-y divide-line">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="py-2.5 flex gap-3 text-sm" data-guild-audit-row data-audit-action={r.action}>
            <div className="w-[90px] shrink-0 text-xs text-text-2 pt-0.5" title={new Date(r.created_at).toLocaleString()}>{relativeTime(r.created_at)}</div>
            <div className="min-w-0">
              <span className="font-semibold">@{r.actor_name || t('unknown')}</span> <span className="text-text-1">{LABELS[r.action] ? t(LABELS[r.action]) : r.action}</span>
              {r.target_name && <span className="font-semibold"> {r.target_kind === 'user' ? '@' : r.target_kind === 'channel' ? '#' : ''}{r.target_name}</span>}
              {describe(r) && <div className="text-xs text-text-2 truncate" data-audit-detail>{describe(r)}</div>}
            </div>
          </div>
        ))}
      </div>
      {!done && rows && rows.length > 0 && <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={() => load(rows[rows.length - 1].id)}>{t('Load more')}</button>}
    </div>
  )
}
