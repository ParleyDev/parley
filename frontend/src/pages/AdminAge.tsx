import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import { can, useAccess } from './adminAccess'

interface AgeSettings {
  accept_level: 'declared' | 'attested' | 'verified'; attestation: boolean; provider: '' | 'oidc' | 'http'; provider_name: string
  oidc_authorize_url: string; oidc_token_url: string; oidc_client_id: string; oidc_client_secret_set: boolean; oidc_issuer: string; oidc_claim: string; oidc_scope: string
  http_url: string; http_token_set: boolean; valid_days: number; provider_ready: boolean; pending_requests: number
}
interface AgeRequest { id: string; user: { id: string; username: string; display_name: string; avatar_url: string | null; created_at: string }; note: string; status: string; reply: string; created_at: string }
interface AgeRecord { id: string; threshold: number; level: 'declared' | 'attested' | 'verified'; provider: string; note: string; by: string | null; verified_at: string; expires_at: string | null; revoked_at: string | null; revoked_why: string }

/** What each level of proof is called in the console. */
export const AGE_LEVELS: Record<string, string> = { declared: 'Said so themselves', attested: 'Confirmed by staff', verified: 'Verified by a service' }

/**
 * Admin › Age Checks. Restricted channels and servers open only to accounts confirmed as adult. This page sets what
 * counts as confirmed, answers members who asked the staff to confirm them, and connects an outside service.
 */
export function AgeChecksPane() {
  const t = useT()
  const access = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const manage = can(access, 'instance_manage')
  const attest = can(access, 'age_attest')
  const [cfg, setCfg] = useState<AgeSettings | null>(null)
  const [draft, setDraft] = useState<AgeSettings | null>(null)
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [requests, setRequests] = useState<AgeRequest[]>([])
  const [answer, setAnswer] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const take = (c: AgeSettings) => { setCfg(c); setDraft(c); setSecret(''); setToken('') }
  const loadRequests = () => api.get<AgeRequest[]>('/admin/age/requests').then(setRequests).catch(() => setRequests([]))
  useEffect(() => {
    if (manage) api.get<AgeSettings>('/admin/age/settings').then(take).catch((e) => pushToast((e as Error).message, 'error'))
    if (attest) void loadRequests()
  }, [manage, attest]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const set = (patch: Partial<AgeSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const dirty = !!cfg && !!draft && (JSON.stringify(cfg) !== JSON.stringify(draft) || !!secret || !!token)
  const save = () => run(async () => {
    if (!draft) return
    take(await api.put<AgeSettings>('/admin/age/settings', { ...draft, ...(secret ? { oidc_client_secret: secret } : {}), ...(token ? { http_token: token } : {}) }))
    pushToast(t('Saved'))
  })
  const decide = (r: AgeRequest, approve: boolean) => run(async () => {
    const text = (answer[r.id] ?? '').trim()
    await api.post(`/admin/age/requests/${r.id}`, approve ? { approve: true, note: text } : { approve: false, reply: text })
    pushToast(approve ? t('{name} is confirmed as an adult', { name: r.user.display_name || r.user.username }) : t('Request declined'))
    await loadRequests()
  })
  return (
    <div className="max-w-2xl space-y-6" data-admin-age>
      <div>
        <h1 className="text-xl font-bold">{t('Age checks')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Age-restricted channels and servers open only to accounts confirmed as 18 or older. Everyone else is treated as a possible minor: those places stay closed to them, and messages from people they have not added arrive as requests with media hidden. Parley keeps no date of birth and no documents.')}</p>
      </div>

      {attest && (
        <section className="space-y-3 rounded-xl border border-line p-4" data-age-requests={requests.length}>
          <div>
            <h2 className="font-bold">{t('Requests from members')}</h2>
            <p className="text-sm text-text-2">{t('Members who asked the staff to confirm they are adults. Confirm only what you have checked yourself, and say how: it is kept with the record and in the audit log. Never ask for identity documents to be sent through Parley.')}</p>
          </div>
          {requests.length === 0 ? <p className="text-sm text-text-2">{t('No requests are waiting.')}</p> : requests.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border border-line bg-bg-1 p-3 text-sm" data-age-request-row={r.user.username}>
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/admin/users/${r.user.id}`} className="font-semibold hover:underline">{r.user.display_name || r.user.username}</Link>
                <span className="text-text-2">@{r.user.username}</span>
                <span className="ml-auto text-xs text-text-2">{t('asked {when} · account from {created}', { when: formatTime(r.created_at), created: new Date(r.user.created_at).toLocaleDateString() })}</span>
              </div>
              {r.note && <p className="whitespace-pre-wrap text-text-1">{r.note}</p>}
              <input className="input w-full" placeholder={t('How you confirmed it, or why you are declining')} value={answer[r.id] ?? ''} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} data-age-answer />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => decide(r, false)} data-age-decline>{t('Decline')}</button>
                <button type="button" className="btn-primary" disabled={busy || (answer[r.id] ?? '').trim().length < 3} onClick={() => decide(r, true)} data-age-approve>{t('Confirm as adult')}</button>
              </div>
            </div>
          ))}
          <p className="text-xs text-text-2">{t('To confirm someone who has not asked, or to withdraw a confirmation, open their account under Users.')}</p>
        </section>
      )}

      {manage && draft && cfg && (
        <>
          <section className="space-y-3 rounded-xl border border-line p-4" data-age-policy={cfg.accept_level}>
            <div>
              <h2 className="font-bold">{t('What counts as confirmed')}</h2>
              <p className="text-sm text-text-2">{t('The weakest proof that opens age-restricted places on this instance.')}</p>
            </div>
            {([['declared', t('The member saying so'), t('Anyone who states they are 18 or older gets in. This is how Parley worked before age checks, and it is not proof.')],
              ['attested', t('Staff confirmation'), t('A member of staff has confirmed it, or a verification service has.')],
              ['verified', t('A verification service only'), t('Only an answer from the service set up below counts.')]] as const).map(([v, label, detail]) => (
              <label key={v} className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${draft.accept_level === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-1'}`} data-age-level={v}>
                <input type="radio" name="age_accept_level" className="mt-1 accent-accent" checked={draft.accept_level === v} onChange={() => set({ accept_level: v })} />
                <span><span className="font-semibold">{label}</span><span className="block text-text-2">{detail}</span></span>
              </label>
            ))}
            {draft.accept_level === 'verified' && !cfg.provider_ready && <p className="text-sm text-warn">{t('No verification service is set up, so nobody can be confirmed and age-restricted places will be closed to everyone.')}</p>}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={draft.attestation} onChange={(e) => set({ attestation: e.target.checked })} data-age-attestation />
              <span><span className="font-semibold">{t('Staff may confirm ages')}</span><span className="block text-text-2">{t('Members can ask, and trust-and-safety leads and super admins can confirm. Off: only a verification service can.')}</span></span></label>
            <label className="block"><span className="label">{t('A confirmation lasts (days, 0 = until withdrawn)')}</span><input className="input w-32" type="number" min={0} max={3650} value={draft.valid_days} onChange={(e) => set({ valid_days: Math.max(0, Number(e.target.value) || 0) })} data-age-valid-days /></label>
          </section>

          <section className="space-y-3 rounded-xl border border-line p-4" data-age-provider={cfg.provider} data-age-provider-ready={cfg.provider_ready ? '1' : '0'}>
            <div>
              <h2 className="font-bold">{t('Verification service')}</h2>
              <p className="text-sm text-text-2">{t('Optional. A service that checks a person\'s age and tells Parley only whether they meet it. Parley works with any service that signs people in with OpenID Connect, or with a small adapter you run for one that does not. See docs/self-hosting/age-assurance.md.')}</p>
            </div>
            <label className="block"><span className="label">{t('Kind')}</span>
              <select className="input w-full" value={draft.provider} onChange={(e) => set({ provider: e.target.value as AgeSettings['provider'] })} data-age-provider-kind>
                <option value="">{t('None')}</option><option value="oidc">OpenID Connect</option><option value="http">{t('Adapter (HTTP)')}</option>
              </select></label>
            {draft.provider !== '' && <label className="block"><span className="label">{t('Name shown to members')}</span><input className="input w-full" maxLength={60} value={draft.provider_name} onChange={(e) => set({ provider_name: e.target.value })} data-age-provider-name /></label>}
            {draft.provider === 'oidc' && (
              <>
                <label className="block"><span className="label">{t('Issuer')}</span><input className="input w-full" placeholder="https://verify.example" value={draft.oidc_issuer} onChange={(e) => set({ oidc_issuer: e.target.value })} data-age-oidc-issuer /></label>
                <label className="block"><span className="label">{t('Sign-in address')}</span><input className="input w-full" placeholder="https://verify.example/authorize" value={draft.oidc_authorize_url} onChange={(e) => set({ oidc_authorize_url: e.target.value })} data-age-oidc-authorize /></label>
                <label className="block"><span className="label">{t('Token address')}</span><input className="input w-full" placeholder="https://verify.example/token" value={draft.oidc_token_url} onChange={(e) => set({ oidc_token_url: e.target.value })} data-age-oidc-token /></label>
                <label className="block"><span className="label">{t('Client ID')}</span><input className="input w-full" value={draft.oidc_client_id} onChange={(e) => set({ oidc_client_id: e.target.value })} data-age-oidc-client /></label>
                <label className="block"><span className="label">{t('Client secret')}</span><input className="input w-full" type="password" autoComplete="off" placeholder={cfg.oidc_client_secret_set ? t('A secret is set. Type a new one to replace it.') : ''} value={secret} onChange={(e) => setSecret(e.target.value)} data-age-oidc-secret /></label>
                <label className="block"><span className="label">{t('Claim that must be true ({n} is the age)')}</span><input className="input w-full" value={draft.oidc_claim} onChange={(e) => set({ oidc_claim: e.target.value })} data-age-oidc-claim /></label>
                <label className="block"><span className="label">{t('Scope')}</span><input className="input w-full" value={draft.oidc_scope} onChange={(e) => set({ oidc_scope: e.target.value })} /></label>
              </>
            )}
            {draft.provider === 'http' && (
              <>
                <label className="block"><span className="label">{t('Adapter address')}</span><input className="input w-full" placeholder="https://age-adapter.example.internal/start" value={draft.http_url} onChange={(e) => set({ http_url: e.target.value })} data-age-http-url /></label>
                <label className="block"><span className="label">{t('Shared token')}</span><input className="input w-full" type="password" autoComplete="off" placeholder={cfg.http_token_set ? t('A token is set. Type a new one to replace it.') : t('Sent to the adapter, and required from it when it reports a result')} value={token} onChange={(e) => setToken(e.target.value)} data-age-http-token /></label>
              </>
            )}
          </section>
          <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save} data-age-save>{t('Save')}</button>
        </>
      )}
    </div>
  )
}

/** Admin › a user's account: where they stand on age, the records behind it, and confirm / withdraw / undo. */
export function UserAgeCard({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const t = useT()
  const access = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<{ age_group: string; declared_minor: boolean; attestation: boolean; records: AgeRecord[] } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const allowed = can(access, 'age_attest')
  const load = () => api.get<typeof data>(`/admin/age/users/${userId}`).then(setData).catch(() => setData(null))
  useEffect(() => { if (allowed) void load() }, [userId, allowed]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed || !data) return null
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); await load() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const current = data.records.filter((r) => !r.revoked_at && (!r.expires_at || new Date(r.expires_at) > new Date()))
  const group = data.age_group === 'teen' ? t('Marked as under 18') : data.age_group === 'adult' ? t('Confirmed as an adult') : t('Not confirmed (treated as a possible minor)')
  return (
    <section className="min-w-0 rounded-xl border border-line bg-bg-1 p-4" data-admin-card="age" data-age-group={data.age_group}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-2">{t('Age')}</h2>
      <p className="text-sm font-semibold">{group}</p>
      <div className="mt-2 space-y-1.5">
        {data.records.map((r) => {
          const live = current.includes(r)
          return (
            <div key={r.id} className={`flex flex-wrap items-center gap-2 text-sm ${live ? '' : 'text-text-2 line-through'}`} data-age-record={r.level} data-age-record-live={live ? '1' : '0'}>
              <span>{t(AGE_LEVELS[r.level])} · {r.threshold}+</span>
              <span className="text-xs text-text-2">{new Date(r.verified_at).toLocaleDateString()}{r.by ? ` · @${r.by}` : r.level === 'verified' ? ` · ${r.provider}` : ''}{r.expires_at ? ` · ${t('until {date}', { date: new Date(r.expires_at).toLocaleDateString() })}` : ''}</span>
              {r.note && <span className="w-full text-xs text-text-2 no-underline">{r.note}</span>}
              {live && <button type="button" className="ml-auto text-xs text-danger hover:underline" disabled={busy} data-age-revoke
                onClick={() => { const why = window.prompt(t('Why are you withdrawing this? (kept in the audit log)')); if (why !== null) void run(() => api.post(`/admin/age/assurances/${r.id}/revoke`, { reason: why })) }}>{t('Withdraw')}</button>}
            </div>
          )
        })}
      </div>
      {data.declared_minor ? (
        <button type="button" className="mt-3 text-sm text-sky-400 hover:underline" disabled={busy} data-age-clear-minor
          onClick={() => { const why = window.prompt(t('Why is "under 18" wrong for this account? (kept in the audit log)')); if (why) void run(() => api.post(`/admin/age/users/${userId}/clear-minor`, { reason: why })) }}>{t('Remove the under-18 mark')}</button>
      ) : data.attestation && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <input className="input w-full" placeholder={t('How you confirmed they are 18 or older')} value={note} onChange={(e) => setNote(e.target.value)} data-age-attest-note />
          <button type="button" className="btn-primary" disabled={busy || note.trim().length < 3} data-age-attest onClick={() => run(async () => { await api.post(`/admin/age/users/${userId}/attest`, { threshold: 18, note }); setNote(''); pushToast(t('Confirmed as an adult')) })}>{isSelf ? t('Confirm my own account as adult') : t('Confirm as adult')}</button>
          {isSelf && <p className="text-xs text-text-2">{t('Confirming your own account is recorded as such in the audit log.')}</p>}
        </div>
      )}
    </section>
  )
}
