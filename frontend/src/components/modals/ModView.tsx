import { AlertTriangle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { useStore } from '../../store'

interface Warning { id: string; reason: string; created_at: string; moderator_name: string | null }
interface ModInfo {
  joined_at: string; account_created_at: string; joined_via: string | null; inviter_name: string | null; temporary: boolean
  timeout_until: string | null; email_verified: boolean; messages: number; warnings: Warning[]
  history: { action: string; actor_name: string | null; details: Record<string, unknown>; created_at: string }[]
}

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d < 1 ? 'today' : d < 60 ? `${d} day${d === 1 ? '' : 's'} ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`
}
const ACTIONS: Record<string, string> = { 'member.ban': 'Banned', 'member.unban': 'Unbanned', 'member.kick': 'Kicked', 'member.timeout': 'Timed out', 'member.timeout_remove': 'Timeout removed', 'member.warn': 'Warned', 'member.warn_remove': 'Warning removed', 'member.update': 'Member updated', 'member.roles': 'Roles changed' }

/** Moderator view of a member: how and when they joined, account age, activity, warnings and moderation history. */
export default function ModViewModal({ onClose, guildId, userId }: { onClose: () => void; guildId: string; userId: string }) {
  const member = useStore((s) => s.members[guildId]?.[userId])
  const user = useStore((s) => s.users[userId])
  const pushToast = useStore((s) => s.pushToast)
  const [info, setInfo] = useState<ModInfo | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api.get<ModInfo>(`/guilds/${guildId}/members/${userId}/mod-info`).then(setInfo).catch((e: Error) => { pushToast(e.message, 'error'); onClose() }), [guildId, userId, pushToast, onClose])
  useEffect(() => { void load() }, [load])
  const name = member?.nickname ?? member?.display_name ?? user?.display_name ?? 'Member'
  const warn = async () => {
    setBusy(true)
    try { await api.post(`/guilds/${guildId}/members/${userId}/warnings`, { reason }); setReason(''); pushToast(`${name} was warned`); await load() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const unwarn = async (id: string) => { try { await api.delete(`/guilds/${guildId}/members/${userId}/warnings/${id}`); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const fresh = info && Date.now() - new Date(info.account_created_at).getTime() < 7 * 86_400_000
  return (
    <Modal title="Moderator View" onClose={onClose} width="max-w-lg">
      <div className="space-y-5" data-mod-view={userId}>
        <div className="flex items-center gap-3">
          <Avatar user={{ id: userId, display_name: name, avatar_url: member?.avatar_url ?? user?.avatar_url ?? null }} size={48} />
          <div className="min-w-0"><div className="font-bold truncate">{name}</div><div className="text-sm text-text-2 truncate">@{member?.username ?? user?.username}</div></div>
          {fresh && <span className="ml-auto flex items-center gap-1 rounded-md bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn" data-mod-new-account><AlertTriangle size={13} /> New account</span>}
        </div>
        {!info ? <p className="text-sm text-text-2">Loading…</p> : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-mod-facts>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Account created</dt><dd data-mod-account-age>{ago(info.account_created_at)}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Joined server</dt><dd>{ago(info.joined_at)}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Join method</dt><dd data-mod-join-method>{info.joined_via === 'discover' ? 'Discover' : info.joined_via ? `Invite ${info.joined_via}${info.inviter_name ? ` from ${info.inviter_name}` : ''}` : 'Unknown'}{info.temporary ? ' · temporary' : ''}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Messages here</dt><dd data-mod-messages>{info.messages}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Email</dt><dd>{info.email_verified ? 'Verified' : 'Not verified'}</dd></div>
              {info.timeout_until && new Date(info.timeout_until) > new Date() && <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">Timed out until</dt><dd>{new Date(info.timeout_until).toLocaleString()}</dd></div>}
            </dl>
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">Warnings — {info.warnings.length}</h3>
              <div className="space-y-1.5" data-mod-warnings>
                {info.warnings.map((w) => (
                  <div key={w.id} className="flex items-start gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-mod-warning={w.id}>
                    <span className="min-w-0 flex-1"><span className="block break-words">{w.reason}</span><span className="text-xs text-text-2">{w.moderator_name ?? 'A moderator'} · {ago(w.created_at)}</span></span>
                    <button type="button" onClick={() => unwarn(w.id)} title="Remove warning" className="text-text-2 hover:text-danger" data-mod-unwarn={w.id}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="input flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} placeholder="Reason for a warning (they will see it)" data-mod-warn-reason />
                <button type="button" className="btn-danger shrink-0" disabled={busy || !reason.trim()} onClick={warn} data-mod-warn>Warn</button>
              </div>
            </section>
            {info.history.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">Moderation history</h3>
                <ul className="space-y-1 text-sm" data-mod-history>
                  {info.history.map((h, i) => <li key={i} className="flex gap-2"><span className="font-medium">{ACTIONS[h.action] ?? h.action}</span><span className="text-text-2 truncate">by {h.actor_name ?? 'someone'}{typeof h.details.reason === 'string' && h.details.reason ? ` — ${h.details.reason}` : ''}</span><span className="ml-auto shrink-0 text-xs text-text-2">{ago(h.created_at)}</span></li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
