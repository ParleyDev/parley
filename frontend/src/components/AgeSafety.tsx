import { Cake, Gavel, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PrivateUser } from '../lib/types'
import { useStore } from '../store'

/** Enter your birth date (once). Under 18 turns on teen safety defaults; 18+ opens age-restricted channels. */
export function BirthdateForm({ onDone }: { onDone?: (u: PrivateUser) => void }) {
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { const u = await api.put<PrivateUser>('/users/@me/birthdate', { birthdate: date }); const st = useStore.getState(); if (st.token) setAuth(st.token, { ...st.user, ...u } as PrivateUser); onDone?.(u) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-end gap-2" data-birthdate-form>
      <label className="flex-1"><span className="label">Date of birth</span><input type="date" className="input" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} data-birthdate-input /></label>
      <button type="button" className="btn-primary" disabled={busy || !date} onClick={save} data-birthdate-save>Confirm</button>
      <p className="w-full text-xs text-text-2">You can only set this once, so check it. It's never shown to anyone.</p>
    </div>
  )
}

/** User Settings › My Account: your birth date (set once) and what it means. */
export function AgeSection() {
  const me = useStore((s) => s.user) as PrivateUser | null
  if (!me) return null
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-2" data-age-section={me.age_group ?? 'unknown'}>
      <div className="flex items-center gap-2"><Cake size={18} className="text-text-2" /><h3 className="font-bold">Date of Birth</h3>{me.birthdate && <span className="ml-auto text-sm text-text-1" data-birthdate>{new Date(`${me.birthdate}T00:00:00`).toLocaleDateString()}</span>}</div>
      {me.birthdate ? (
        <p className="text-sm text-text-2">{me.age_group === 'teen' ? 'Teen safety defaults are on: only friends can DM you, sensitive media is blurred, and age-restricted channels are closed.' : 'You can view age-restricted channels.'} Ask an administrator if it's wrong.</p>
      ) : <><p className="text-sm text-text-2">Needed to view age-restricted (18+) channels.</p><BirthdateForm /></>}
    </section>
  )
}

interface MyBan { guild_id: string; name: string; icon_url: string | null; reason: string; banned_at: string; appeal: { status: 'pending' | 'accepted' | 'denied'; reason: string } | null }

/** User Settings › My Account: servers you're banned from, with an appeal (once per ban). */
export function MyBans() {
  const pushToast = useStore((s) => s.pushToast)
  const [bans, setBans] = useState<MyBan[] | null>(null)
  const [writing, setWriting] = useState<string | null>(null)
  const [text, setText] = useState('')
  const load = () => api.get<MyBan[]>('/users/@me/bans').then(setBans).catch(() => setBans([]))
  useEffect(() => { void load() }, [])
  if (!bans?.length) return null
  const send = async (gid: string) => { try { await api.post(`/guilds/${gid}/appeal`, { text }); setWriting(null); setText(''); pushToast('Appeal sent'); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-my-bans>
      <div className="flex items-center gap-2"><Gavel size={18} className="text-text-2" /><h3 className="font-bold">Server Bans</h3></div>
      {bans.map((b) => (
        <div key={b.guild_id} className="rounded-lg border border-line bg-bg-1 p-3 text-sm" data-my-ban={b.guild_id}>
          <div className="flex items-center gap-2"><span className="flex-1 font-semibold">{b.name}</span><span className="text-xs text-text-2">{new Date(b.banned_at).toLocaleDateString()}</span></div>
          {b.reason && <p className="mt-1 text-text-2">Reason: {b.reason}</p>}
          {b.appeal ? <p className={`mt-1 text-xs ${b.appeal.status === 'denied' ? 'text-danger' : 'text-text-2'}`} data-appeal-status={b.appeal.status}>{b.appeal.status === 'pending' ? 'Appeal sent — waiting for the moderators.' : b.appeal.status === 'denied' ? `Appeal denied${b.appeal.reason ? `: ${b.appeal.reason}` : '.'}` : 'Appeal accepted.'}</p>
            : writing === b.guild_id ? (
              <div className="mt-2 space-y-2">
                <textarea className="input resize-none" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why should the moderators lift the ban?" data-appeal-text />
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setWriting(null)}>Cancel</button><button type="button" className="btn-primary" disabled={text.trim().length < 10} onClick={() => send(b.guild_id)} data-appeal-send>Send appeal</button></div>
              </div>
            ) : <button type="button" className="mt-2 text-sm text-sky-400 hover:underline" onClick={() => { setWriting(b.guild_id); setText('') }} data-appeal-open={b.guild_id}>Appeal this ban</button>}
        </div>
      ))}
    </section>
  )
}

interface Appeal { user: { id: string; username: string; display_name: string; avatar_url: string | null }; text: string; created_at: string; ban_reason: string }

/** Server Settings › Bans: appeals waiting for a decision. */
export function BanAppeals({ guildId, onAccepted }: { guildId: string; onAccepted: (userId: string) => void }) {
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Appeal[]>([])
  useEffect(() => { api.get<Appeal[]>(`/guilds/${guildId}/appeals`).then(setList).catch(() => setList([])) }, [guildId])
  if (!list.length) return null
  const decide = async (a: Appeal, ok: boolean) => {
    const reason = ok ? '' : prompt(`Why are you denying ${a.user.display_name}'s appeal? (optional)`)
    if (reason === null) return
    try { await api.post(`/guilds/${guildId}/appeals/${a.user.id}/${ok ? 'accept' : 'deny'}`, ok ? {} : { reason }); setList(list.filter((x) => x.user.id !== a.user.id)); if (ok) onAccepted(a.user.id); pushToast(ok ? `${a.user.display_name} was unbanned` : 'Appeal denied') } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <section className="mt-4 space-y-2" data-ban-appeals>
      <h2 className="label">Appeals ({list.length})</h2>
      {list.map((a) => (
        <div key={a.user.id} className="rounded-xl border border-line bg-bg-1 p-3 text-sm" data-ban-appeal={a.user.id}>
          <div className="flex items-center gap-2"><span className="flex-1 font-semibold">{a.user.display_name} <span className="font-normal text-text-2">@{a.user.username}</span></span>
            <button type="button" className="btn-primary py-1" onClick={() => decide(a, true)} data-appeal-accept={a.user.id}>Unban</button>
            <button type="button" className="btn-ghost py-1" onClick={() => decide(a, false)} data-appeal-deny={a.user.id}>Deny</button></div>
          {a.ban_reason && <p className="mt-1 text-xs text-text-2">Banned for: {a.ban_reason}</p>}
          <p className="mt-1 whitespace-pre-wrap text-text-1">{a.text}</p>
        </div>
      ))}
    </section>
  )
}

/** Teens see this at the top of a DM with someone who isn't their friend. */
export function TeenDmNotice({ name, onBlock }: { name: string; onBlock: () => void }) {
  return (
    <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm" data-teen-notice>
      <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
      <span className="flex-1"><b>{name}</b> isn't on your friends list. Be careful: don't share personal details or photos, and never agree to meet. You can block or report them any time.</span>
      <button type="button" className="shrink-0 text-xs font-semibold text-danger hover:underline" onClick={onBlock} data-teen-block>Block</button>
    </div>
  )
}
