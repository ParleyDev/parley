import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { relativeTime } from '../../../lib/ua'

interface Row { id: string; actor_id: string | null; actor_name: string; action: string; target_kind: string; target_id: string | null; target_name: string; details: Record<string, unknown>; created_at: string }

const LABELS: Record<string, string> = {
  'guild.update': 'updated the server', 'guild.transfer': 'transferred ownership to',
  'channel.create': 'created channel', 'channel.update': 'edited channel', 'channel.delete': 'deleted channel', 'channel.overwrite': 'changed permissions in', 'channel.overwrite_delete': 'removed a permission overwrite in',
  'role.create': 'created role', 'role.update': 'edited role', 'role.delete': 'deleted role',
  'member.kick': 'kicked', 'member.ban': 'banned', 'member.unban': 'unbanned', 'member.timeout': 'timed out', 'member.timeout_clear': 'removed the timeout of', 'member.update': 'updated member',
  'message.delete': 'deleted a message by', 'emoji.create': 'added emoji', 'emoji.update': 'renamed emoji', 'emoji.delete': 'deleted emoji',
  'sticker.create': 'added sticker', 'sticker.update': 'edited sticker', 'sticker.delete': 'deleted sticker',
  'discovery.submit': 'submitted to Discover', 'discovery.withdraw': 'withdrew from Discover',
}

const describe = (r: Row): string => {
  const d = r.details ?? {}
  switch (r.action) {
    case 'member.timeout': return `for ${d.minutes} minute${d.minutes === 1 ? '' : 's'}`
    case 'member.ban': return typeof d.reason === 'string' && d.reason ? `reason: ${d.reason}` : ''
    case 'member.update': return [Array.isArray(d.roles) ? `roles: ${(d.roles as string[]).join(', ') || 'none'}` : '', 'nickname' in d ? `nickname: ${d.nickname ?? 'cleared'}` : ''].filter(Boolean).join(' · ')
    case 'message.delete': return `in #${d.channel}`
    case 'guild.update': case 'role.update': case 'channel.update': return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
    case 'channel.overwrite': return `${d.kind} overwrite · allow ${d.allow} · deny ${d.deny}`
    case 'discovery.submit': return `category: ${d.category}`
    default: return ''
  }
}

/** Server Settings → Audit Log: who changed what, newest first. */
export default function AuditLogTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (before?: string) => {
    setBusy(true)
    try {
      const page = await api.get<Row[]>(`/guilds/${guildId}/audit?q=${encodeURIComponent(q)}${before ? `&before=${before}` : ''}`)
      setRows((r) => before && r ? [...r, ...page] : page); setDone(page.length < 100)
    } catch { setRows((r) => r ?? []) } finally { setBusy(false) }
  }
  useEffect(() => { const t = setTimeout(() => load(), 150); return () => clearTimeout(t) }, [guildId, q]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!guild) return null
  return (
    <div data-guild-audit>
      <h1 className="text-xl font-bold">Audit Log</h1>
      <p className="text-sm text-text-2 mt-1">Moderation and settings changes in {guild.name}, newest first.</p>
      <div className="relative mt-4 mb-4">
        <input className="input pl-9" placeholder="Filter by member, action or target" value={q} onChange={(e) => setQ(e.target.value)} data-guild-audit-search />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
      </div>
      {rows && rows.length === 0 && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2" data-guild-audit-empty>{busy ? 'Loading…' : 'Nothing logged yet.'}</div>}
      <div className="divide-y divide-line">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="py-2.5 flex gap-3 text-sm" data-guild-audit-row data-audit-action={r.action}>
            <div className="w-[90px] shrink-0 text-xs text-text-2 pt-0.5" title={new Date(r.created_at).toLocaleString()}>{relativeTime(r.created_at)}</div>
            <div className="min-w-0">
              <span className="font-semibold">@{r.actor_name || 'unknown'}</span> <span className="text-text-1">{LABELS[r.action] ?? r.action}</span>
              {r.target_name && <span className="font-semibold"> {r.target_kind === 'user' ? '@' : r.target_kind === 'channel' ? '#' : ''}{r.target_name}</span>}
              {describe(r) && <div className="text-xs text-text-2 truncate" data-audit-detail>{describe(r)}</div>}
            </div>
          </div>
        ))}
      </div>
      {!done && rows && rows.length > 0 && <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={() => load(rows[rows.length - 1].id)}>Load more</button>}
    </div>
  )
}
