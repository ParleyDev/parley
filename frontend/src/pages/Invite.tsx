import { APP_NAME } from '../lib/brand'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'
import { useStore } from '../store'
import type { Channel, DmChannel, Guild } from '../lib/types'
import { colorFor, initials } from '../lib/format'
import { markJoined } from '../lib/welcome'

interface GroupPreview { code: string; channel_id: string; name: string; icon_url: string | null; already_member: boolean; full: boolean; members: { id: string; display_name: string; avatar_url: string | null }[] }
interface Preview { code: string; guild: { id: string; name: string; icon_url: string | null; member_count: number; rules?: string; rules_required?: boolean; splash_url?: string | null; description?: string }; expired: boolean; already_member: boolean; banned: boolean; paused?: boolean }

export default function InvitePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [group, setGroup] = useState<GroupPreview | null>(null)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Server invites first; group DM invite links share the /invite/ path.
    api.get<Preview>(`/invites/${code}`).then(setP).catch((e) => api.get<GroupPreview>(`/group-invites/${code}`).then(setGroup).catch(() => setErr((e as Error).message)))
  }, [code])

  const join = async () => {
    setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>(`/invites/${code}`)
      upsertGuild(g); markJoined(g.id)
      const first = g.channels.find((c) => c.kind === 'text')
      navigate(first ? `/channels/${g.id}/${first.id}` : `/channels/${g.id}`, { replace: true })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="relative h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 bg-cover bg-center p-4" style={p?.guild.splash_url ? { backgroundImage: `linear-gradient(rgb(0 0 0 / .45), rgb(0 0 0 / .45)), url(${p.guild.splash_url})` } : undefined} data-invite-splash={p?.guild.splash_url ? '1' : '0'}>
      <div className="pop w-full max-w-sm rounded-2xl bg-bg-1 border border-line p-8 text-center shadow-2xl">
        {group ? (
          <div data-group-invite-page>
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full text-2xl font-bold text-white" style={{ background: group.icon_url ? undefined : colorFor(group.channel_id) }}>
              {group.icon_url ? <img src={group.icon_url} className="h-full w-full object-cover" alt="" /> : initials(group.name || group.members.map((m) => m.display_name).join(', '))}
            </div>
            <p className="text-text-2 text-sm">You've been invited to join a group</p>
            <h1 className="text-2xl font-bold mb-1" data-group-invite-name>{group.name || group.members.map((m) => m.display_name).join(', ')}</h1>
            <p className="text-text-2 text-sm mb-6">{group.members.length} member{group.members.length === 1 ? '' : 's'}</p>
            {err && <p className="mb-3 text-sm text-danger">{err}</p>}
            {group.already_member ? <button className="btn-primary w-full" onClick={() => navigate(`/channels/@me/${group.channel_id}`)}>Open group</button>
              : group.full ? <p className="text-danger text-sm">This group is full.</p>
              : <button className="btn-primary w-full" disabled={busy} data-group-invite-join onClick={async () => { setBusy(true); try { const c = await api.post<DmChannel>(`/group-invites/${code}`); upsertChannel(c); navigate(`/channels/@me/${c.id}`, { replace: true }) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>{busy ? 'Joining…' : 'Join Group'}</button>}
          </div>
        ) : err ? (
          <>
            <h1 className="text-xl font-bold mb-2">Invite invalid</h1>
            <p className="text-text-2 text-sm mb-6">{err}</p>
            <button className="btn-primary w-full" onClick={() => navigate('/channels/@me')}>Continue to {APP_NAME}</button>
          </>
        ) : !p ? (
          <p className="text-text-2">Loading…</p>
        ) : (
          <>
            <div className="mx-auto mb-4 h-20 w-20 rounded-3xl overflow-hidden flex items-center justify-center text-2xl font-bold text-white" style={{ background: p.guild.icon_url ? undefined : colorFor(p.guild.id) }}>
              {p.guild.icon_url ? <img src={p.guild.icon_url} className="h-full w-full object-cover" alt="" /> : initials(p.guild.name)}
            </div>
            <p className="text-text-2 text-sm">You've been invited to join</p>
            <h1 className="text-2xl font-bold mb-1">{p.guild.name}</h1>
            <p className="text-text-2 text-sm mb-6">{p.guild.member_count} member{p.guild.member_count === 1 ? '' : 's'}</p>
            {p.guild.rules && (
              <div className="mb-6 rounded-xl border border-line bg-bg-1 p-3 text-left" data-invite-rules>
                <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-1">Server rules{p.guild.rules_required ? ' · you will be asked to accept these' : ''}</div>
                <div className="msg-content text-sm text-text-1 max-h-40 overflow-y-auto">{renderMarkdown(p.guild.rules)}</div>
              </div>
            )}
            {p.already_member ? (
              <button className="btn-primary w-full" onClick={() => navigate(`/channels/${p.guild.id}`)}>Open server</button>
            ) : p.banned ? (
              <p className="text-danger text-sm">You are banned from this server.</p>
            ) : p.expired ? (
              <p className="text-danger text-sm">This invite has expired.</p>
            ) : p.paused ? (
              <p className="text-warn text-sm" data-invite-paused>This server has paused new members for now. Try again later.</p>
            ) : (
              <button className="btn-primary w-full" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Accept Invite'}</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
