import { Gavel, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { shownName } from '../lib/names'

interface MyBan { guild_id: string; name: string; icon_url: string | null; reason: string; banned_at: string; appeal: { status: 'pending' | 'accepted' | 'denied'; reason: string } | null }

/** User Settings › My Account: servers you're banned from, with an appeal (once per ban). */
export function MyBans() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [bans, setBans] = useState<MyBan[] | null>(null)
  const [writing, setWriting] = useState<string | null>(null)
  const [text, setText] = useState('')
  const load = () => api.get<MyBan[]>('/users/@me/bans').then(setBans).catch(() => setBans([]))
  useEffect(() => { void load() }, [])
  if (!bans?.length) return null
  const send = async (gid: string) => { try { await api.post(`/guilds/${gid}/appeal`, { text }); setWriting(null); setText(''); pushToast(t('Appeal sent')); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-my-bans>
      <div className="flex items-center gap-2"><Gavel size={18} className="text-text-2" /><h3 className="font-bold">{t('Server Bans')}</h3></div>
      {bans.map((b) => (
        <div key={b.guild_id} className="rounded-lg border border-line bg-bg-1 p-3 text-sm" data-my-ban={b.guild_id}>
          <div className="flex items-center gap-2"><span className="flex-1 font-semibold">{b.name}</span><span className="text-xs text-text-2">{new Date(b.banned_at).toLocaleDateString()}</span></div>
          {b.reason && <p className="mt-1 text-text-2">{t('Reason: {reason}', { reason: b.reason })}</p>}
          {b.appeal ? <p className={`mt-1 text-xs ${b.appeal.status === 'denied' ? 'text-danger' : 'text-text-2'}`} data-appeal-status={b.appeal.status}>{b.appeal.status === 'pending' ? t('Appeal sent — waiting for the moderators.') : b.appeal.status === 'denied' ? (b.appeal.reason ? t('Appeal denied: {reason}', { reason: b.appeal.reason }) : t('Appeal denied.')) : t('Appeal accepted.')}</p>
            : writing === b.guild_id ? (
              <div className="mt-2 space-y-2">
                <textarea className="input resize-none" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Why should the moderators lift the ban?')} data-appeal-text />
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setWriting(null)}>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={text.trim().length < 10} onClick={() => send(b.guild_id)} data-appeal-send>{t('Send appeal')}</button></div>
              </div>
            ) : <button type="button" className="mt-2 text-sm text-sky-400 hover:underline" onClick={() => { setWriting(b.guild_id); setText('') }} data-appeal-open={b.guild_id}>{t('Appeal this ban')}</button>}
        </div>
      ))}
    </section>
  )
}

interface Appeal { user: { id: string; username: string; display_name: string; avatar_url: string | null }; text: string; created_at: string; ban_reason: string }

/** Server Settings › Bans: appeals waiting for a decision. */
export function BanAppeals({ guildId, onAccepted }: { guildId: string; onAccepted: (userId: string) => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const notes = useStore((s) => s.notes)
  const [list, setList] = useState<Appeal[]>([])
  useEffect(() => { api.get<Appeal[]>(`/guilds/${guildId}/appeals`).then(setList).catch(() => setList([])) }, [guildId])
  if (!list.length) return null
  const decide = async (a: Appeal, ok: boolean) => {
    const reason = ok ? '' : prompt(t("Why are you denying {name}'s appeal? (optional)", { name: shownName(a.user, null, notes[a.user.id]?.nickname) }))
    if (reason === null) return
    try { await api.post(`/guilds/${guildId}/appeals/${a.user.id}/${ok ? 'accept' : 'deny'}`, ok ? {} : { reason }); setList(list.filter((x) => x.user.id !== a.user.id)); if (ok) onAccepted(a.user.id); pushToast(ok ? t('{name} was unbanned', { name: shownName(a.user, null, notes[a.user.id]?.nickname) }) : t('Appeal denied')) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <section className="mt-4 space-y-2" data-ban-appeals>
      <h2 className="label">{t('Appeals ({n})', { n: list.length })}</h2>
      {list.map((a) => (
        <div key={a.user.id} className="rounded-xl border border-line bg-bg-1 p-3 text-sm" data-ban-appeal={a.user.id}>
          <div className="flex items-center gap-2"><span className="flex-1 font-semibold">{shownName(a.user, null, notes[a.user.id]?.nickname)} <span className="font-normal text-text-2">@{a.user.username}</span></span>
            <button type="button" className="btn-primary py-1" onClick={() => decide(a, true)} data-appeal-accept={a.user.id}>{t('Unban')}</button>
            <button type="button" className="btn-ghost py-1" onClick={() => decide(a, false)} data-appeal-deny={a.user.id}>{t('Deny')}</button></div>
          {a.ban_reason && <p className="mt-1 text-xs text-text-2">{t('Banned for: {reason}', { reason: a.ban_reason })}</p>}
          <p className="mt-1 whitespace-pre-wrap text-text-1">{a.text}</p>
        </div>
      ))}
    </section>
  )
}

/** Teens see this at the top of a DM with someone who isn't their friend. */
export function TeenDmNotice({ name, onBlock }: { name: string; onBlock: () => void }) {
  const t = useT()
  return (
    <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm" data-teen-notice>
      <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
      <span className="flex-1"><b>{name}</b> {t("isn't on your friends list. Be careful: don't share personal details or photos, and never agree to meet. You can block or report them any time.")}</span>
      <button type="button" className="shrink-0 text-xs font-semibold text-danger hover:underline" onClick={onBlock} data-teen-block>{t('Block')}</button>
    </div>
  )
}
