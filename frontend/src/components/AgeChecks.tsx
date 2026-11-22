import { Cake, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { type AgeStatus, useAgeStatus } from '../lib/age'
import { useT } from '../lib/i18n'
import { useStore } from '../store'

/**
 * The ways this instance offers to confirm that you are an adult: its own verification service, asking its staff,
 * or (only while the instance accepts it) saying so yourself. Shown in My Account and on the lock of an
 * age-restricted channel.
 */
export function AgePaths({ status, onChange }: { status: AgeStatus; onChange: (s: AgeStatus) => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const { can, request } = status
  const pending = request?.status === 'pending'
  if (status.age_group !== 'unknown') return null
  if (!can.verify && !can.request && !can.declare_adult && !pending) {
    return <p className="text-sm text-text-2" data-age-paths="none">{t('This instance has no way to confirm ages yet, so age-restricted channels and servers stay closed.')}</p>
  }
  return (
    <div className="space-y-2 text-left" data-age-paths>
      {can.verify && (
        <button type="button" className="btn-primary w-full" disabled={busy} data-age-verify
          onClick={() => run(async () => { const r = await api.post<{ url: string }>('/users/@me/age/verify'); window.location.href = r.url })}>
          {t('Verify with {provider}', { provider: status.provider_name ?? '' })}
        </button>
      )}
      {pending ? (
        <div className="rounded-lg border border-line bg-bg-1 p-3 text-sm" data-age-request="pending">
          <p>{t('Your request is with the staff of this instance. You will be let in as soon as they confirm it.')}</p>
          <button type="button" className="mt-1 text-xs text-text-2 hover:underline" disabled={busy} data-age-withdraw onClick={() => run(async () => onChange(await api.delete<AgeStatus>('/users/@me/age/request')))}>{t('Withdraw the request')}</button>
        </div>
      ) : can.request && (asking ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg-1 p-3">
          <label className="block"><span className="label">{t('Anything the staff should know (optional)')}</span>
            <textarea className="input resize-none" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-age-note /></label>
          <p className="text-xs text-text-2">{t('They may contact you to confirm. Do not send identity documents here.')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>{t('Cancel')}</button>
            <button type="button" className="btn-primary" disabled={busy} data-age-ask-send onClick={() => run(async () => { onChange(await api.post<AgeStatus>('/users/@me/age/request', { note })); setAsking(false); setNote('') })}>{t('Send request')}</button>
          </div>
        </div>
      ) : <button type="button" className={can.verify ? 'btn-ghost w-full' : 'btn-primary w-full'} data-age-ask onClick={() => setAsking(true)}>{t('Ask the staff to confirm I am an adult')}</button>)}
      {request?.status === 'declined' && !pending && <p className="text-xs text-text-2" data-age-request="declined">{request.reply ? t('The staff declined your last request: {reply}', { reply: request.reply }) : t('The staff declined your last request.')}</p>}
      {can.declare_adult && (
        <button type="button" className="btn-ghost w-full" disabled={busy} data-age-declare-adult onClick={() => run(async () => onChange(await api.post<AgeStatus>('/users/@me/age/declare', { adult: true })))}>{t('I am 18 or older')}</button>
      )}
    </div>
  )
}

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** User Settings › My Account: where you stand on age, how to be confirmed as an adult, and an optional birthday. */
export function AgeSection() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [status, setStatus] = useAgeStatus()
  const [month, setMonth] = useState<number | null>(null)
  const [day, setDay] = useState<number | null>(null)
  if (!status) return null
  const m = month ?? status.birthday?.month ?? 0
  const d = day ?? status.birthday?.day ?? 0
  const saved = status.birthday
  const dirty = (m !== (saved?.month ?? 0) || d !== (saved?.day ?? 0)) && m > 0 && d > 0
  const run = async (f: () => Promise<void>) => { try { await f() } catch (e) { pushToast((e as Error).message, 'error') } }
  const saveBirthday = (mm: number | null, dd: number | null) => run(async () => { setStatus(await api.put<AgeStatus>('/users/@me/birthday', { month: mm, day: dd })); setMonth(null); setDay(null) })
  const sayMinor = () => {
    if (!window.confirm(t('Mark this account as under 18? Age-restricted places stay closed, only friends can message you, and only an administrator can undo it.'))) return
    void run(async () => setStatus(await api.post<AgeStatus>('/users/@me/age/declare', { adult: false })))
  }
  const current = status.records.find((r) => r.counts)
  const how = !current ? '' : current.level === 'verified' ? t('Verified by {provider} on {date}.', { provider: current.provider, date: new Date(current.verified_at).toLocaleDateString() })
    : current.level === 'attested' ? t('Confirmed by the staff of this instance on {date}.', { date: new Date(current.verified_at).toLocaleDateString() })
    : t('You said you are 18 or older.')
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-age-section={status.age_group}>
      <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-text-2" /><h3 className="font-bold">{t('Age')}</h3></div>
      {status.age_group === 'teen' && <p className="text-sm text-text-2">{t('This account is marked as under 18. Age-restricted channels and servers are closed, only friends can message you, and sensitive media is blurred or blocked. Ask an administrator if this is wrong.')}</p>}
      {status.age_group === 'adult' && <p className="text-sm text-text-2" data-age-how={current?.level}>{t('You can open age-restricted channels and servers.')} {how}{current?.expires_at ? ' ' + t('Good until {date}.', { date: new Date(current.expires_at).toLocaleDateString() }) : ''}</p>}
      {status.age_group === 'unknown' && (
        <>
          <p className="text-sm text-text-2">{t('Parley does not ask for your date of birth. Until you are confirmed as an adult, age-restricted channels and servers stay closed, and messages from people you have not added arrive as requests with pictures, files and link previews hidden.')}</p>
          <AgePaths status={status} onChange={setStatus} />
        </>
      )}
      <div className="border-t border-line pt-3">
        <div className="flex items-center gap-2"><Cake size={16} className="text-text-2" /><span className="text-sm font-semibold">{t('Birthday (optional)')}</span></div>
        <p className="mt-1 text-xs text-text-2">{t('A day and a month, without the year. Only you can see it, and it says nothing about your age.')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2" data-birthday={saved ? `${saved.month}-${saved.day}` : ''}>
          <select className="input w-auto" value={m} onChange={(e) => { setMonth(Number(e.target.value)); if (d > MONTH_DAYS[Number(e.target.value) - 1]) setDay(1) }} data-birthday-month aria-label={t('Month')}>
            <option value={0}>{t('Month')}</option>
            {MONTH_DAYS.map((_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' })}</option>)}
          </select>
          <select className="input w-auto" value={d} onChange={(e) => setDay(Number(e.target.value))} data-birthday-day aria-label={t('Day')}>
            <option value={0}>{t('Day')}</option>
            {Array.from({ length: m ? MONTH_DAYS[m - 1] : 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!dirty} onClick={() => saveBirthday(m, d)} data-birthday-save>{t('Save')}</button>
          {saved && <button type="button" className="btn-ghost" onClick={() => saveBirthday(null, null)} data-birthday-clear>{t('Remove')}</button>}
        </div>
      </div>
      {status.can.declare_minor && <button type="button" className="text-xs text-text-2 hover:underline" onClick={sayMinor} data-age-declare-minor>{t('I am under 18')}</button>}
    </section>
  )
}

interface Standing { sanctions: { kind: 'limit' | 'suspend'; reason: string; expires_at: string | null }[] }

/** User Settings › My Account: said plainly when the instance has limited this account, and until when. */
export function StandingNotice() {
  const t = useT()
  const tick = useStore((s) => s.ageTick)
  const [st, setSt] = useState<Standing | null>(null)
  useEffect(() => { let live = true; api.get<Standing>('/users/@me/standing').then((x) => { if (live) setSt(x) }).catch(() => {}); return () => { live = false } }, [tick])
  const limit = st?.sanctions.find((x) => x.kind === 'limit')
  if (!limit) return null
  return (
    <section className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm" data-standing="limit">
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
      <div>
        <div className="font-semibold">{limit.expires_at ? t('Your account is limited until {date}', { date: new Date(limit.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }) : t('Your account is limited')}</div>
        <p className="text-text-2">{t('You can carry on in the servers and conversations you already have. Until the limit ends you cannot message people you are not friends with, send friend requests, join or create servers, or make invites. If you think this is a mistake, contact the people who run this Parley instance.')}</p>
      </div>
    </section>
  )
}
