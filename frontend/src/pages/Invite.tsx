import { APP_NAME } from '../lib/brand'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'
import { useStore } from '../store'
import type { Channel, Guild } from '../lib/types'
import { colorFor, initials } from '../lib/format'

interface Preview { code: string; guild: { id: string; name: string; icon_url: string | null; member_count: number; rules?: string; rules_required?: boolean }; expired: boolean; already_member: boolean; banned: boolean }

export default function InvitePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<Preview>(`/invites/${code}`).then(setP).catch((e) => setErr((e as Error).message))
  }, [code])

  const join = async () => {
    setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>(`/invites/${code}`)
      upsertGuild(g)
      const first = g.channels.find((c) => c.kind === 'text')
      navigate(first ? `/channels/${g.id}/${first.id}` : `/channels/${g.id}`, { replace: true })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 p-4">
      <div className="pop w-full max-w-sm rounded-2xl bg-bg-1 border border-line p-8 text-center shadow-2xl">
        {err ? (
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
            ) : (
              <button className="btn-primary w-full" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Accept Invite'}</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
