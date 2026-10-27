import { Check, Copy, Search, Send } from 'lucide-react'
import { describeInvite, EXPIRY, maxAgeOf, USES } from '../../lib/invites'
import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { publicOrigin } from '../InviteCard'
import { useStore } from '../../store'
import type { DmChannel, Invite } from '../../lib/types'
import Avatar from '../Avatar'
import { useT } from '../../lib/i18n'

export default function InviteModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const relationships = useStore((s) => s.relationships)
  const members = useStore((s) => s.members[guildId])
  const sendMessage = useStore((s) => s.sendMessage)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState<string | null>(null)
  const friends = Object.values(relationships).filter((r) => r.kind === 'friend').map((r) => r.user).filter((u) => !q || u.display_name.toLowerCase().includes(q.toLowerCase()) || u.username.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const [invite, setInvite] = useState<Invite | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [maxAge, setMaxAge] = useState(0)
  const [maxUses, setMaxUses] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // Reuse your own never-expiring, unlimited link when you may list invites (Manage Server); otherwise mint one.
    const me = useStore.getState().user?.id
    api.get<Invite[]>(`/guilds/${guildId}/invites`).catch(() => [] as Invite[])
      .then((list) => list.find((i) => !i.vanity && i.max_uses === null && !i.expires_at && i.creator_id === me) ?? api.post<Invite>(`/guilds/${guildId}/invites`, {}))
      .then(setInvite).catch((e) => setErr((e as Error).message))
  }, [guildId])
  const generate = async () => {
    setBusy(true); setErr(null)
    try { setInvite(await api.post<Invite>(`/guilds/${guildId}/invites`, { max_age: maxAge, max_uses: maxUses })); setEditing(false); setSent({}) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const shownAge = invite ? maxAgeOf(invite) : 0
  const link = invite ? `${publicOrigin()}/invite/${invite.code}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }
  const sendTo = async (userId: string) => {
    if (!link) return
    setSending(userId)
    try {
      const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: userId })
      upsertChannel(c); await sendMessage(c.id, link); setSent((x) => ({ ...x, [userId]: true }))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setSending(null) }
  }
  return (
    <Modal title={t('Invite friends to {name}', { name: guild?.name ?? t('server') })} onClose={onClose}>
      {err && <p className="text-sm text-danger mb-2">{err}</p>}
      <label className="label">{t('Send a server invite link to a friend')}</label>
      <div className="flex items-center gap-2 rounded-lg bg-bg-0/60 border border-line p-1 pl-3">
        <input readOnly value={link || t('Generating…')} className="flex-1 bg-transparent text-sm outline-none" onFocus={(e) => e.target.select()} />
        <button onClick={copy} disabled={!link} className={`btn ${copied ? 'bg-success text-white' : 'bg-accent text-white hover:bg-accent-hover'} py-1.5`}>{copied ? <><Check size={14} /> {t('Copied')}</> : <><Copy size={14} /> {t('Copy')}</>}</button>
      </div>
      {editing ? (
        <div className="mt-3 rounded-lg border border-line bg-bg-0/40 p-3 space-y-3" data-invite-settings>
          <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
            <div><label className="label">{t('Expire after')}</label>
              <select className="input" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} data-invite-expiry>{EXPIRY.map((o) => <option key={o.s} value={o.s}>{t(o.label)}</option>)}</select></div>
            <div><label className="label">{t('Max number of uses')}</label>
              <select className="input" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} data-invite-uses>{USES.map((o) => <option key={o.n} value={o.n}>{t(o.label)}</option>)}</select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost py-1.5" onClick={() => setEditing(false)}>{t('Cancel')}</button>
            <button type="button" className="btn-primary py-1.5" onClick={generate} disabled={busy} data-invite-generate>{busy ? t('Generating…') : t('Generate a New Link')}</button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-2" data-invite-summary>
          {invite ? describeInvite(shownAge, invite.max_uses ?? 0) : '\u00a0'}{' '}
          <button type="button" className="text-sky-400 hover:underline" onClick={() => { setMaxAge(shownAge); setMaxUses(invite?.max_uses ?? 0); setEditing(true) }} data-invite-edit>{t('Edit invite link')}</button>
        </p>
      )}
      <div className="mt-5">
        <div className="relative">
          <input className="input pl-9" placeholder={t('Search friends')} value={q} onChange={(e) => setQ(e.target.value)} data-invite-friend-search />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-line rounded-lg border border-line" data-invite-friends>
          {friends.length === 0 && <p className="p-4 text-sm text-text-2">{q ? t('No friends match.') : t('Add some friends to invite them directly.')}</p>}
          {friends.map((u) => {
            const already = !!members?.[u.id]
            return (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2" data-invite-friend={u.id}>
                <Avatar user={u} size={32} />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{u.display_name}</div><div className="truncate text-xs text-text-2">@{u.username}</div></div>
                {already ? <span className="text-xs text-text-2">{t('Already a member')}</span>
                  : sent[u.id] ? <span className="flex items-center gap-1 text-xs text-success"><Check size={14} /> {t('Sent')}</span>
                  : <button type="button" className="btn-primary py-1 text-xs" disabled={!link || sending === u.id} onClick={() => sendTo(u.id)} data-invite-send><Send size={13} /> {t('Invite')}</button>}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
