import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Channel, Guild, Role } from '../lib/types'
import { useStore } from '../store'
import { colorFor, initials } from '../lib/format'
import { markJoined } from '../lib/welcome'

interface Preview { code: string; guild: { id: string; name: string; icon_url: string | null; member_count: number; online_count: number }; expired: boolean; already_member: boolean; banned: boolean }

/** The address invite links should carry: the instance's public URL, else wherever we are. */
export function publicOrigin(): string {
  const app = useStore.getState().instance.app_url?.replace(/\/+$/, '')
  return app && /^https?:\/\//.test(app) ? app : location.origin
}

/** Invite links to this instance found in a message body (at most three): links to the current address or to the
 *  instance's public URL both count, so a link pasted on the public domain still renders as a card on the LAN. */
export function inviteCodes(content: string, extraOrigins: (string | undefined)[] = [useStore.getState().instance.app_url]): string[] {
  if (!content || !content.includes('/invite/')) return []
  const origins = Array.from(new Set([location.origin, ...extraOrigins.filter((o): o is string => !!o).map((o) => o.replace(/\/+$/, ''))]))
  const esc = (o: string) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:${origins.map(esc).join('|')})/invite/([A-Za-z0-9_-]+)`, 'g')
  const out: string[] = []
  for (const m of content.matchAll(re)) if (!out.includes(m[1])) out.push(m[1])
  return out.slice(0, 3)
}

const cache = new Map<string, Promise<Preview | null>>()

/** Discord-style invite embed: server icon, name, counts, Join / Joined / Expired. */
export default function InviteCard({ code }: { code: string }) {
  const [pv, setPv] = useState<Preview | null | undefined>(undefined)
  const guilds = useStore((s) => s.guilds)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let p = cache.get(code)
    if (!p) { p = api.get<Preview>(`/invites/${code}`).catch(() => null); cache.set(code, p) }
    let live = true; p.then((v) => { if (live) setPv(v) }); return () => { live = false }
  }, [code])
  if (pv === undefined) return null
  if (pv === null) return <div className="mt-1 max-w-[440px] rounded-lg border border-line bg-bg-1 p-3 text-sm text-text-2" data-invite-card={code} data-invite-state="invalid">This invite is invalid or has expired.</div>
  const member = pv.already_member || !!guilds[pv.guild.id]
  const join = async () => {
    setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[]; roles: Role[] }>(`/invites/${code}`, {})
      upsertGuild(g); markJoined(g.id); cache.delete(code); pushToast(`Welcome to ${g.name}!`); navigate(`/channels/${g.id}`)
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const state = pv.banned ? 'banned' : pv.expired && !member ? 'expired' : member ? 'member' : 'open'
  return (
    <div className="mt-1 flex max-w-[440px] items-center gap-3 rounded-lg border border-line bg-bg-1 p-3" data-invite-card={code} data-invite-state={state}>
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl flex items-center justify-center text-white font-semibold" style={{ background: pv.guild.icon_url ? undefined : colorFor(pv.guild.id) }}>
        {pv.guild.icon_url ? <img src={pv.guild.icon_url} alt="" className="h-full w-full object-cover" /> : initials(pv.guild.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-2">{member ? 'You are a member of' : 'You have been invited to join'}</div>
        <div className="font-semibold truncate" data-invite-name>{pv.guild.name}</div>
        <div className="flex items-center gap-3 text-xs text-text-2"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />{pv.guild.online_count} Online</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-text-2" />{pv.guild.member_count} Members</span></div>
      </div>
      {state === 'member' ? <button type="button" className="btn-ghost py-1.5" onClick={() => navigate(`/channels/${pv.guild.id}`)} data-invite-open>Joined</button>
        : state === 'open' ? <button type="button" className="btn-primary bg-success hover:bg-success/80 text-black py-1.5" disabled={busy} onClick={join} data-invite-join>Join</button>
        : <span className="text-xs text-text-2">{state === 'banned' ? 'Banned' : 'Expired'}</span>}
    </div>
  )
}
