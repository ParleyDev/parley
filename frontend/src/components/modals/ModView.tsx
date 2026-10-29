import { AlertTriangle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

interface Warning { id: string; reason: string; created_at: string; moderator_name: string | null }
interface ModInfo {
  joined_at: string; account_created_at: string; joined_via: string | null; inviter_name: string | null; temporary: boolean
  timeout_until: string | null; email_verified: boolean; messages: number; warnings: Warning[]
  history: { action: string; actor_name: string | null; details: Record<string, unknown>; created_at: string }[]
}

type T = ReturnType<typeof useT>
const ago = (iso: string, t: T) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d < 1 ? t('today') : d < 60 ? (d === 1 ? t('{n} day ago', { n: d }) : t('{n} days ago', { n: d })) : d < 730 ? t('{n} months ago', { n: Math.round(d / 30) }) : t('{n} years ago', { n: Math.round(d / 365) })
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
  const t = useT()
  const load = useCallback(() => api.get<ModInfo>(`/guilds/${guildId}/members/${userId}/mod-info`).then(setInfo).catch((e: Error) => { pushToast(e.message, 'error'); onClose() }), [guildId, userId, pushToast, onClose])
  useEffect(() => { void load() }, [load])
  const name = member?.nickname || member?.display_name || user?.display_name || t('Member')
  const warn = async () => {
    setBusy(true)
    try { await api.post(`/guilds/${guildId}/members/${userId}/warnings`, { reason }); setReason(''); pushToast(t('{name} was warned', { name })); await load() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const unwarn = async (id: string) => { try { await api.delete(`/guilds/${guildId}/members/${userId}/warnings/${id}`); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const fresh = info && Date.now() - new Date(info.account_created_at).getTime() < 7 * 86_400_000
  const quarantined = !!member?.quarantined
  const quarantine = async (on: boolean) => { try { await api.post(`/guilds/${guildId}/members/${userId}/quarantine`, { on }); pushToast(on ? t('{name} is quarantined', { name }) : t('{name} is released', { name })); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <Modal title={t('Moderator View')} onClose={onClose} width="max-w-lg">
      <div className="space-y-5" data-mod-view={userId}>
        <div className="flex items-center gap-3">
          <Avatar user={{ id: userId, display_name: name, avatar_url: member?.avatar_url ?? user?.avatar_url ?? null }} size={48} />
          <div className="min-w-0"><div className="font-bold truncate">{name}</div><div className="text-sm text-text-2 truncate">@{member?.username ?? user?.username}</div></div>
          <span className="ml-auto flex flex-wrap justify-end gap-1">
            {fresh && <span className="flex items-center gap-1 rounded-md bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn" data-mod-new-account><AlertTriangle size={13} /> {t('New account')}</span>}
            {member?.flags?.includes('raid') && <span className="rounded-md bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn" data-mod-flag="raid">{t('Joined in a raid')}</span>}
            {quarantined && <span className="rounded-md bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger" data-mod-quarantined>{t('Quarantined')}</span>}
          </span>
        </div>
        {!info ? <p className="text-sm text-text-2">{t('Loading…')}</p> : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-mod-facts>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Account created')}</dt><dd data-mod-account-age>{ago(info.account_created_at, t)}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Joined server')}</dt><dd>{ago(info.joined_at, t)}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Join method')}</dt><dd data-mod-join-method>{info.joined_via === 'discover' ? t('Discover') : info.joined_via ? (info.inviter_name ? t('Invite {code} from {name}', { code: info.joined_via, name: info.inviter_name }) : t('Invite {code}', { code: info.joined_via })) : t('Unknown')}{info.temporary ? t(' · temporary') : ''}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Messages here')}</dt><dd data-mod-messages>{info.messages}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Email')}</dt><dd>{info.email_verified ? t('Verified') : t('Not verified')}</dd></div>
              {info.timeout_until && new Date(info.timeout_until) > new Date() && <div><dt className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Timed out until')}</dt><dd>{new Date(info.timeout_until).toLocaleString()}</dd></div>}
            </dl>
            <div className="flex items-center gap-3 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm">
              <span className="flex-1">{quarantined ? t('They can read but not post, react or join voice.') : t('Quarantine makes them read-only until you release them.')}</span>
              <button type="button" className={quarantined ? 'btn-primary py-1' : 'btn-danger py-1'} onClick={() => quarantine(!quarantined)} data-mod-quarantine={quarantined ? 'release' : 'quarantine'}>{quarantined ? t('Release') : t('Quarantine')}</button>
            </div>
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Warnings')} — {info.warnings.length}</h3>
              <div className="space-y-1.5" data-mod-warnings>
                {info.warnings.map((w) => (
                  <div key={w.id} className="flex items-start gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-mod-warning={w.id}>
                    <span className="min-w-0 flex-1"><span className="block break-words">{w.reason}</span><span className="text-xs text-text-2">{w.moderator_name ?? t('A moderator')} · {ago(w.created_at, t)}</span></span>
                    <button type="button" onClick={() => unwarn(w.id)} title={t('Remove warning')} className="text-text-2 hover:text-danger" data-mod-unwarn={w.id}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="input flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} placeholder={t('Reason for a warning (they will see it)')} data-mod-warn-reason />
                <button type="button" className="btn-danger shrink-0" disabled={busy || !reason.trim()} onClick={warn} data-mod-warn>{t('Warn')}</button>
              </div>
            </section>
            {info.history.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Moderation history')}</h3>
                <ul className="space-y-1 text-sm" data-mod-history>
                  {info.history.map((h, i) => <li key={i} className="flex gap-2"><span className="font-medium">{ACTIONS[h.action] ? t(ACTIONS[h.action]) : h.action}</span><span className="text-text-2 truncate">{t('by {name}', { name: h.actor_name ?? t('someone') })}{typeof h.details.reason === 'string' && h.details.reason ? ` — ${h.details.reason}` : ''}</span><span className="ml-auto shrink-0 text-xs text-text-2">{ago(h.created_at, t)}</span></li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
