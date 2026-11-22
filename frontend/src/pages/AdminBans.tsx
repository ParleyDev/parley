import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import { can, useAccess } from './adminAccess'

interface Sanction { id: string; user_id: string | null; username: string | null; kind: 'limit' | 'quiet' | 'suspend'; reason: string; note: string; source: 'staff' | 'auto'; hard: boolean; expires_at: string | null; by: string | null; created_at: string; lifted_at: string | null; lifted_by: string | null; lift_note: string; active: boolean }
interface Flag { id: string; user: { id: string; username: string; display_name: string; created_at: string; suspended: boolean }; kind: string; details: Record<string, unknown>; sanction_id: string | null; action: string | null; action_active: boolean; created_at: string }

/** What each action is called. Keys of `kind` on a sanction. */
export const SANCTION_KINDS: Record<string, string> = { limit: 'Limited (soft ban)', quiet: 'Silenced', suspend: 'Suspended' }
/** Why. Keys of `reason` on a sanction. */
export const SANCTION_REASONS: Record<string, string> = { spam: 'Spam', underage: 'Says they are under 13', evasion: 'Getting round a ban', abuse: 'Abuse', other: 'Something else' }
/** What a detector noticed. Keys of `kind` on a flag. */
export const FLAG_KINDS: Record<string, string> = {
  duplicate_text: 'The same message sent to many places', link_spam: 'Links from a new account to many places', mention_spam: 'Mass mentions',
  dm_burst: 'A new account messaging many people', friend_burst: 'A new account sending many friend requests', reports: 'Reported by several people', evasion: 'Signed up from the network of a banned account',
}

function span(s: Sanction, t: ReturnType<typeof useT>) {
  if (!s.expires_at) return t('until lifted')
  return t('until {date}', { date: new Date(s.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })
}

/**
 * Admin › Bans & Limits: what the instance noticed on its own (the review queue), and every action in force.
 * Per-server moderation is the servers' own; this is the instance acting on an account everywhere.
 */
export function BansPane() {
  const t = useT()
  const access = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [active, setActive] = useState<Sanction[]>([])
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const [f, a, s] = await Promise.all([api.get<Flag[]>('/admin/abuse/flags'), api.get<Sanction[]>('/admin/sanctions'), api.get<{ auto_actions: boolean }>('/admin/abuse/settings')])
    setFlags(f); setActive(a); setAuto(s.auto_actions)
  }
  useEffect(() => { load().catch((e) => pushToast((e as Error).message, 'error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); await load() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const review = (f: Flag, outcome: 'kept' | 'undone' | 'dismissed') => run(() => api.post(`/admin/abuse/flags/${f.id}`, { outcome }))
  const lift = (s: Sanction) => {
    const note = window.prompt(s.reason === 'underage' ? t('What showed the account holder is 13 or older? (kept in the audit log)') : t('Why are you lifting this? (kept in the audit log)'))
    if (note !== null) void run(() => api.post(`/admin/sanctions/${s.id}/lift`, { note }))
  }
  if (!flags) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  return (
    <div className="max-w-3xl space-y-6" data-admin-bans>
      <div>
        <h1 className="text-xl font-bold">{t('Bans & limits')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Actions the instance takes on an account everywhere. Limited (a soft ban): the account carries on where it already is but cannot start new conversations, add friends, or join or create servers. Silenced: its first messages and friend requests look sent and reach nobody. Suspended: it cannot sign in; with an end date it is a temporary ban, and a hard ban also stops its email address registering again. To act on an account, open it under Users.')}</p>
      </div>

      <section className="space-y-3 rounded-xl border border-line p-4" data-abuse-queue={flags.length}>
        <div>
          <h2 className="font-bold">{t('Waiting for review')}</h2>
          <p className="text-sm text-text-2">{t('What Parley noticed across the instance. The most it does by itself is limit an account for three days; staff, bots and guests are never acted on automatically. Keep the action if it was right, undo it if it was not.')}</p>
        </div>
        {can(access, 'instance_manage') && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={auto} disabled={busy} data-abuse-auto
            onChange={(e) => run(() => api.put('/admin/abuse/settings', { auto_actions: e.target.checked }))} />
            <span><span className="font-semibold">{t('Limit accounts automatically')}</span><span className="block text-text-2">{t('Off: suspected spam is only listed here, and nothing is done until a person decides.')}</span></span></label>
        )}
        {flags.length === 0 ? <p className="text-sm text-text-2">{t('Nothing is waiting.')}</p> : flags.map((f) => (
          <div key={f.id} className="space-y-2 rounded-lg border border-line bg-bg-1 p-3 text-sm" data-abuse-flag={f.kind} data-abuse-flag-user={f.user.username}>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/admin/users/${f.user.id}`} className="font-semibold hover:underline">{f.user.display_name || f.user.username}</Link>
              <span className="text-text-2">@{f.user.username}</span>
              <span className="ml-auto text-xs text-text-2">{formatTime(f.created_at)} · {t('account from {created}', { created: new Date(f.user.created_at).toLocaleDateString() })}</span>
            </div>
            <div className="font-semibold">{t(FLAG_KINDS[f.kind] ?? f.kind)}</div>
            <div className="text-xs text-text-2">{Object.entries(f.details).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}</div>
            <div className="text-xs">{f.action && f.action_active ? t('Done automatically: {action}', { action: t(SANCTION_KINDS[f.action] ?? f.action) }) : t('Nothing was done automatically.')}</div>
            <div className="flex flex-wrap justify-end gap-2">
              {f.action && f.action_active
                ? <><button type="button" className="btn-ghost" disabled={busy} onClick={() => review(f, 'undone')} data-flag-undo>{t('Undo the action')}</button><button type="button" className="btn-primary" disabled={busy} onClick={() => review(f, 'kept')} data-flag-keep>{t('Keep it')}</button></>
                : <button type="button" className="btn-ghost" disabled={busy} onClick={() => review(f, 'dismissed')} data-flag-dismiss>{t('Dismiss')}</button>}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-line p-4" data-sanctions-active={active.length}>
        <h2 className="font-bold">{t('In force now')}</h2>
        {active.length === 0 ? <p className="text-sm text-text-2">{t('No account is limited, silenced or suspended by the instance.')}</p> : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {active.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-sanction-row={s.kind} data-sanction-user={s.username ?? ''}>
                {s.user_id ? <Link to={`/admin/users/${s.user_id}`} className="font-semibold hover:underline">@{s.username}</Link> : <span className="text-text-2">{t('(account removed)')}</span>}
                <span>{t(SANCTION_KINDS[s.kind])}{s.hard ? ` · ${t('hard ban')}` : ''}</span>
                <span className="text-text-2">{t(SANCTION_REASONS[s.reason] ?? s.reason)} · {span(s, t)}{s.source === 'auto' ? ` · ${t('automatic')}` : s.by ? ` · @${s.by}` : ''}</span>
                <button type="button" className="ml-auto text-xs text-sky-400 hover:underline" disabled={busy} onClick={() => lift(s)} data-sanction-lift>{t('Lift')}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** Admin › a user's account: the instance's actions on it, and the form to take one. */
export function UserSanctionsCard({ userId, isSelf, onChange }: { userId: string; isSelf: boolean; onChange: () => void }) {
  const t = useT()
  const access = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [rows, setRows] = useState<Sanction[] | null>(null)
  const [kind, setKind] = useState<Sanction['kind']>('limit')
  const [reason, setReason] = useState('spam')
  const [days, setDays] = useState(7)
  const [hard, setHard] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const allowed = can(access, 'content_action')
  const load = () => api.get<Sanction[]>(`/admin/users/${userId}/sanctions`).then(setRows).catch(() => setRows([]))
  useEffect(() => { if (allowed) void load() }, [userId, allowed]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed || !rows) return null
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); await load(); onChange() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const underage = reason === 'underage'
  const submit = () => run(async () => {
    await api.post(`/admin/users/${userId}/sanctions`, { kind: underage ? 'suspend' : kind, reason, note, days: underage ? 0 : days, hard: !underage && kind === 'suspend' && hard })
    setNote('')
  })
  const lift = (s: Sanction) => {
    const why = window.prompt(s.reason === 'underage' ? t('What showed the account holder is 13 or older? (kept in the audit log)') : t('Why are you lifting this? (kept in the audit log)'))
    if (why !== null) void run(() => api.post(`/admin/sanctions/${s.id}/lift`, { note: why }))
  }
  return (
    <section className="min-w-0 rounded-xl border border-line bg-bg-1 p-4 md:col-span-2" data-admin-card="sanctions" data-sanctions-live={rows.filter((r) => r.active).length}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-2">{t('Bans & limits')}</h2>
      {rows.length === 0 && <p className="text-sm text-text-2">{t('The instance has never acted on this account.')}</p>}
      <div className="space-y-1.5">
        {rows.map((s) => (
          <div key={s.id} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${s.active ? '' : 'text-text-2'}`} data-sanction={s.kind} data-sanction-active={s.active ? '1' : '0'}>
            <span className={s.active ? 'font-semibold' : 'line-through'}>{t(SANCTION_KINDS[s.kind])}{s.hard ? ` · ${t('hard ban')}` : ''}</span>
            <span className="text-xs text-text-2">{t(SANCTION_REASONS[s.reason] ?? s.reason)} · {new Date(s.created_at).toLocaleDateString()} · {s.active ? span(s, t) : s.lifted_at ? t('lifted {date}', { date: new Date(s.lifted_at).toLocaleDateString() }) : t('ran out')}{s.source === 'auto' ? ` · ${t('automatic')}` : s.by ? ` · @${s.by}` : ''}</span>
            {s.active && <button type="button" className="ml-auto text-xs text-sky-400 hover:underline" disabled={busy} onClick={() => lift(s)} data-sanction-lift>{t('Lift')}</button>}
            {(s.note || s.lift_note) && <span className="w-full text-xs text-text-2">{s.note}{s.lift_note ? ` → ${s.lift_note}` : ''}</span>}
          </div>
        ))}
      </div>
      {!isSelf && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <label className="block"><span className="label">{t('Reason')}</span>
            <select className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)} data-sanction-reason>
              {Object.entries(SANCTION_REASONS).map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
            </select></label>
          {underage ? <p className="self-end text-xs text-text-2" data-sanction-underage>{t('The account is suspended until a member of staff approves it. Use this when someone says, in text or in voice, that they are under 13, even as a joke.')}</p> : (
            <label className="block"><span className="label">{t('Action')}</span>
              <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value as Sanction['kind'])} data-sanction-kind>
                {Object.entries(SANCTION_KINDS).map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
              </select></label>
          )}
          {!underage && <label className="block"><span className="label">{t('For how many days (0 = until lifted)')}</span><input className="input w-full" type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} data-sanction-days /></label>}
          {!underage && kind === 'suspend' && <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={hard} onChange={(e) => setHard(e.target.checked)} data-sanction-hard />
            <span><span className="font-semibold">{t('Hard ban')}</span><span className="block text-xs text-text-2">{t('Their email address cannot register again, and a new account from the same network is put in front of you.')}</span></span></label>}
          <label className="block sm:col-span-2"><span className="label">{t('Why (kept with the action and in the audit log)')}</span><input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} data-sanction-note /></label>
          <div className="sm:col-span-2"><button type="button" className="btn-primary" disabled={busy || note.trim().length < 3} onClick={submit} data-sanction-apply>{underage ? t('Suspend until approved') : t('Apply')}</button></div>
        </div>
      )}
    </section>
  )
}
