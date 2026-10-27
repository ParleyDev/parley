import QRCode from 'qrcode'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { locale, useT } from '../../../lib/i18n'
import type { User } from '../../../lib/types'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'
import { publicOrigin } from '../../InviteCard'

interface Overview { role: 'teen' | 'adult' | 'unknown'; parents: User[]; teens: User[] }
interface Summary {
  teen: User; days: number; since: string
  servers_joined: { id: string; name: string; icon_url: string | null; joined_at: string }[]
  friends_added: { user: User; at: string }[]
  messaged: { user: User; messages: number }[]
  messages_sent: { direct: number; servers: number }
}

/** A code a parent's phone camera can open (`?family=CODE`) is stashed here until this tab reads it. */
export const FAMILY_CODE_KEY = 'parley.familyCode'

/**
 * Settings → Family Center. Teens make a code for a parent; parents enter it and then see a summary of the teen's
 * last week (servers joined, friends added, who they messaged and how often, never what was said). Teens see the
 * same summary of themselves, and either side can unlink.
 */
export default function FamilyTab() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [o, setO] = useState<Overview | null>(null)
  const load = useCallback(() => { api.get<Overview>('/family').then(setO).catch((e) => pushToast((e as Error).message, 'error')) }, [pushToast])
  useEffect(() => { load(); const f = () => load(); window.addEventListener('parley:family', f); return () => window.removeEventListener('parley:family', f) }, [load])
  const unlink = async (u: User) => { try { await api.delete(`/family/links/${u.id}`); load() } catch (e) { pushToast((e as Error).message, 'error') } }
  if (!o) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  return (
    <div className="space-y-6" data-family-tab data-family-role={o.role}>
      <h2 className="text-xl font-bold">{t('Family Center')}</h2>
      <p className="text-sm text-text-2">{t('A parent linked to a teen account sees which servers they joined, who they added as friends and who they messaged, and how often. Never what anyone said. The teen sees the same summary, and either of you can unlink at any time.')}</p>
      {o.role === 'teen' ? <TeenSide o={o} onUnlink={unlink} /> : o.role === 'adult' ? <ParentSide o={o} onLinked={load} onUnlink={unlink} /> : (
        <p className="text-sm text-text-2" data-family-needs-birthday>{t('Add your birthday in My Account to use Family Center.')}</p>
      )}
    </div>
  )
}

function Person({ u, children }: { u: User; children?: React.ReactNode }) {
  return <div className="flex items-center gap-2 min-w-0"><Avatar user={u} size={28} /><span className="truncate text-sm font-medium">{u.display_name}</span><span className="ms-auto flex items-center gap-2">{children}</span></div>
}

function TeenSide({ o, onUnlink }: { o: Overview; onUnlink: (u: User) => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [code, setCode] = useState<{ code: string; expires_at: string; qr: string } | null>(null)
  const make = async () => {
    try {
      const c = await api.post<{ code: string; expires_at: string }>('/family/code', {})
      const qr = await QRCode.toDataURL(`${publicOrigin()}/channels/@me?family=${c.code}`, { margin: 1, width: 176 })
      setCode({ ...c, qr })
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <>
      <section className="space-y-2">
        <h3 className="label">{t('Link a parent')}</h3>
        {code ? (
          <div className="flex items-center gap-4 rounded-lg border border-line bg-bg-1 p-3" data-family-code={code.code}>
            <img src={code.qr} alt="" className="h-36 w-36 rounded-md bg-white p-1" />
            <div>
              <div className="font-mono text-2xl font-bold tracking-widest">{code.code}</div>
              <p className="mt-1 text-xs text-text-2">{t('Your parent scans this or enters the code in their Family Center. It works once, until {time}.', { time: new Date(code.expires_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })}</p>
            </div>
          </div>
        ) : <button type="button" className="btn-primary" onClick={make} data-family-make-code>{t('Get a code')}</button>}
      </section>
      <section className="space-y-2">
        <h3 className="label">{t('Linked parents')}</h3>
        {o.parents.length === 0 ? <p className="text-sm text-text-2">{t('Nobody yet.')}</p> : o.parents.map((u) => (
          <Person key={u.id} u={u}><button type="button" className="btn-ghost text-danger" onClick={() => onUnlink(u)} data-family-unlink={u.id}>{t('Unlink')}</button></Person>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="label">{t('What they can see')}</h3>
        <SummaryView id="@me" />
      </section>
    </>
  )
}

function ParentSide({ o, onLinked, onUnlink }: { o: Overview; onLinked: () => void; onUnlink: (u: User) => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [code, setCode] = useState(() => { try { const c = sessionStorage.getItem(FAMILY_CODE_KEY) ?? ''; sessionStorage.removeItem(FAMILY_CODE_KEY); return c } catch { return '' } })
  const [open, setOpen] = useState<string | null>(o.teens[0]?.id ?? null)
  const link = async () => {
    try { const r = await api.post<{ teen_id: string }>('/family/links', { code }); setCode(''); setOpen(r.teen_id); pushToast(t('Linked')); onLinked() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <>
      <section className="space-y-2">
        <h3 className="label">{t('Link a teen account')}</h3>
        <div className="flex gap-2">
          <input className="input w-48 font-mono uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="ABCD2345" data-family-code-input />
          <button type="button" className="btn-primary" onClick={link} disabled={code.trim().length < 6} data-family-link>{t('Link')}</button>
        </div>
        <p className="text-xs text-text-2">{t('Ask your teen for the code in their Settings → Family Center, or scan its QR code.')}</p>
      </section>
      <section className="space-y-3">
        <h3 className="label">{t('Linked teens')}</h3>
        {o.teens.length === 0 ? <p className="text-sm text-text-2">{t('Nobody yet.')}</p> : o.teens.map((u) => (
          <div key={u.id} className="rounded-lg border border-line bg-bg-1 p-3 space-y-3" data-family-teen={u.id}>
            <Person u={u}>
              <button type="button" className="btn-ghost" onClick={() => setOpen(open === u.id ? null : u.id)}>{open === u.id ? t('Hide') : t('Show activity')}</button>
              <button type="button" className="btn-ghost text-danger" onClick={() => onUnlink(u)} data-family-unlink={u.id}>{t('Unlink')}</button>
            </Person>
            {open === u.id && <SummaryView id={u.id} />}
          </div>
        ))}
      </section>
    </>
  )
}

function SummaryView({ id }: { id: string }) {
  const t = useT()
  const [s, setS] = useState<Summary | null>(null)
  useEffect(() => { api.get<Summary>(`/family/teens/${id}/summary?days=7`).then(setS).catch(() => setS(null)) }, [id])
  if (!s) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-family-summary>
      <div className="rounded-md bg-bg-2 p-2.5" data-family-servers={s.servers_joined.length}>
        <div className="text-xs font-bold uppercase text-text-2">{t('Servers joined')}</div>
        {s.servers_joined.length === 0 ? <p className="text-sm text-text-2 mt-1">{t('None this week')}</p> : s.servers_joined.map((g) => <div key={g.id} className="mt-1 text-sm truncate">{g.name} <span className="text-xs text-text-2">· {day(g.joined_at)}</span></div>)}
      </div>
      <div className="rounded-md bg-bg-2 p-2.5" data-family-friends={s.friends_added.length}>
        <div className="text-xs font-bold uppercase text-text-2">{t('Friends added')}</div>
        {s.friends_added.length === 0 ? <p className="text-sm text-text-2 mt-1">{t('None this week')}</p> : s.friends_added.map((f) => <div key={f.user.id} className="mt-1"><Person u={f.user} /></div>)}
      </div>
      <div className="rounded-md bg-bg-2 p-2.5" data-family-messaged={s.messaged.length}>
        <div className="text-xs font-bold uppercase text-text-2">{t('Messaged')}</div>
        {s.messaged.length === 0 ? <p className="text-sm text-text-2 mt-1">{t('Nobody this week')}</p> : s.messaged.map((m) => <div key={m.user.id} className="mt-1"><Person u={m.user}><span className="text-xs text-text-2">{m.messages === 1 ? t('1 message') : t('{n} messages', { n: m.messages })}</span></Person></div>)}
      </div>
      <p className="sm:col-span-3 text-xs text-text-2" data-family-totals={`${s.messages_sent.direct},${s.messages_sent.servers}`}>{t('In the last 7 days: {direct} direct messages and {servers} messages in servers.', { direct: s.messages_sent.direct, servers: s.messages_sent.servers })}</p>
    </div>
  )
}
