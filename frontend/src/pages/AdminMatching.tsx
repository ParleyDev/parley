import { CheckCircle2, CircleAlert, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { useStore } from '../store'

interface MatchingConfig {
  service_url: string; service_token_set: boolean; fail_closed: boolean
  hash_lists: { source: string; count: number }[]; hash_total: number; open_matches: number; active: boolean
  added?: number; already_listed?: number; invalid?: number; removed?: number
}

/**
 * Admin › Known-material matching: how uploads are checked against known abuse material. Off until the administrator
 * gives it something to match with: a list of file hashes they are entitled to, or the address of a matching service
 * they are vetted to use. Parley supplies the plumbing (the check on every upload, quarantine, the review queue), not
 * the lists.
 */
export function MatchingSetupPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [cfg, setCfg] = useState<MatchingConfig | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [failClosed, setFailClosed] = useState(false)
  const [source, setSource] = useState('')
  const [hashes, setHashes] = useState('')
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
  const take = (c: MatchingConfig) => { setCfg(c); setUrl(c.service_url); setFailClosed(c.fail_closed); setToken('') }
  useEffect(() => { api.get<MatchingConfig>('/admin/safety/matching').then(take).catch((e) => pushToast((e as Error).message, 'error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const save = () => run(async () => { take(await api.put<MatchingConfig>('/admin/safety/matching', { service_url: url, fail_closed: failClosed, ...(token ? { service_token: token } : {}) })); setProbe(null); pushToast(t('Saved')) })
  const clearToken = () => run(async () => { take(await api.put<MatchingConfig>('/admin/safety/matching', { service_url: url, fail_closed: failClosed, service_token: '' })) })
  const test = () => run(async () => { setProbe(await api.post<{ ok: boolean; message: string }>('/admin/safety/matching/test')) })
  const add = () => run(async () => {
    const c = await api.post<MatchingConfig>('/admin/safety/matching/hashes', { source, hashes })
    setCfg(c); setHashes('')
    pushToast(t('{added} added, {known} already listed, {invalid} not valid', { added: c.added ?? 0, known: c.already_listed ?? 0, invalid: c.invalid ?? 0 }))
  })
  const removeList = (s: string) => run(async () => { setCfg(await api.delete<MatchingConfig>(`/admin/safety/matching/hashes?source=${encodeURIComponent(s)}`)) })
  if (!cfg) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const dirty = url !== cfg.service_url || failClosed !== cfg.fail_closed || !!token
  return (
    <div className="max-w-2xl space-y-6" data-admin-matching data-matching-active={cfg.active ? '1' : '0'}>
      <div>
        <h1 className="text-xl font-bold">{t('Known-material matching')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Checks every upload (attachments, voice messages, profile pictures, banners, emoji, stickers, sounds) against known child sexual abuse material before it can be seen. A match is refused, the file is held in quarantine as evidence, the account is suspended, and the match goes to the review queue.')}</p>
      </div>
      <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${cfg.active ? 'border-success/40 bg-success/10' : 'border-warn/40 bg-warn/10'}`} data-matching-state>
        {cfg.active ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : <CircleAlert size={18} className="mt-0.5 shrink-0 text-warn" />}
        <div>
          <div className="font-semibold">{cfg.active ? t('Matching is on') : t('Matching is off: nothing is set up to match against')}</div>
          <div className="text-text-2">{cfg.active
            ? t('{hashes} file hashes listed · matching service {service}', { hashes: cfg.hash_total.toLocaleString(), service: cfg.service_url ? t('set') : t('not set') })
            : t('Lists of known material are only given to vetted organisations, so Parley cannot ship one. Add a list you are entitled to, or the address of a matching service you have access to.')}</div>
          {cfg.open_matches > 0 && <Link to="/admin/matches" className="mt-1 inline-block font-semibold text-danger hover:underline" data-matching-open>{cfg.open_matches === 1 ? t('1 match is waiting for review') : t('{n} matches are waiting for review', { n: cfg.open_matches })}</Link>}
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-line p-4" data-matching-service>
        <div>
          <h2 className="font-bold">{t('Matching service')}</h2>
          <p className="text-sm text-text-2">{t('The address of a service that recognises known material even when it has been resized or re-encoded. Parley sends it each picture and video and acts on its answer. Run the small adapter described in the self-hosting guide in front of the service you are vetted for.')}</p>
        </div>
        <label className="block"><span className="label">{t('Service address')}</span><input className="input w-full" placeholder="https://matcher.example.internal/check" value={url} onChange={(e) => setUrl(e.target.value)} data-matching-url /></label>
        <label className="block"><span className="label">{t('Access token')}</span>
          <span className="flex gap-2">
            <input className="input flex-1" type="password" autoComplete="off" placeholder={cfg.service_token_set ? t('A token is set. Type a new one to replace it.') : t('Optional: sent to the service as a bearer token')} value={token} onChange={(e) => setToken(e.target.value)} data-matching-token />
            {cfg.service_token_set && <button type="button" className="btn-ghost" disabled={busy} onClick={clearToken} data-matching-token-clear>{t('Remove')}</button>}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={failClosed} onChange={(e) => setFailClosed(e.target.checked)} data-matching-fail-closed />
          <span><span className="font-semibold">{t('Refuse uploads when the service cannot be reached')}</span><span className="block text-text-2">{t('Off: pictures and video go through unchecked while the service is down. On: they are refused until it is back.')}</span></span></label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save} data-matching-save>{t('Save')}</button>
          <button type="button" className="btn-ghost" disabled={busy || !cfg.service_url || dirty} onClick={test} title={dirty ? t('Save first') : undefined} data-matching-test>{t('Send a test picture')}</button>
          {probe && <span className={`text-sm ${probe.ok ? 'text-success' : 'text-danger'}`} data-matching-probe={probe.ok ? 'ok' : 'failed'}>{probe.message}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-line p-4" data-matching-hashes>
        <div>
          <h2 className="font-bold">{t('File hash lists')}</h2>
          <p className="text-sm text-text-2">{t('SHA-256 values of files that must never be stored. A hash only matches an identical copy of a file, so a list is a floor, not a replacement for a matching service.')}</p>
        </div>
        {cfg.hash_lists.length > 0 && (
          <div className="divide-y divide-line rounded-lg border border-line">
            {cfg.hash_lists.map((l) => (
              <div key={l.source} className="flex items-center gap-3 px-3 py-2 text-sm" data-hash-list={l.source}>
                <span className="flex-1 truncate font-semibold">{l.source || t('(no name)')}</span>
                <span className="text-text-2" data-hash-count>{l.count.toLocaleString()}</span>
                <button type="button" disabled={busy} onClick={() => removeList(l.source)} className="text-text-2 hover:text-danger" title={t('Remove this list')} aria-label={t('Remove this list')} data-hash-list-remove><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
        <label className="block"><span className="label">{t('Name of the list')}</span><input className="input w-full" maxLength={60} placeholder={t('For example the name of the feed these came from')} value={source} onChange={(e) => setSource(e.target.value)} data-hash-source /></label>
        <label className="block"><span className="label">{t('Hashes')}</span><textarea className="input h-28 w-full font-mono text-xs" placeholder={t('One SHA-256 value per line (64 hex characters)')} value={hashes} onChange={(e) => setHashes(e.target.value)} data-hash-input /></label>
        <button type="button" className="btn-primary" disabled={busy || !hashes.trim()} onClick={add} data-hash-add>{t('Add to the list')}</button>
      </section>
    </div>
  )
}

interface Match {
  id: string; user_id: string | null; username: string; surface: string; channel_id: string | null; guild_id: string | null
  filename: string; content_type: string; size: number; sha256: string; source: string; reference: string; category: string
  ip: string; user_agent: string; quarantined: boolean; suspended: boolean; status: 'open' | 'reported' | 'released' | 'closed'
  report_ref: string; reported_at: string | null; note: string; legal_hold: boolean; created_at: string; decided_at: string | null
}

/**
 * Admin › Matched uploads: the uploads that matched known abuse material. The record only, never the file: who sent
 * it, from where, what it matched. From here the reviewer notes the report filed with the authority, or releases a
 * false match (which restores the account and destroys the file).
 */
export function MatchesPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Match[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const load = () => api.get<Match[]>('/admin/safety/matches').then(setList).catch((e) => { setList([]); pushToast((e as Error).message, 'error') })
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (id: string, action: string, body: object = {}) => {
    try { const m = await api.patch<Match>(`/admin/safety/matches/${id}`, { action, ...body }); setList((l) => l?.map((x) => (x.id === id ? m : x)) ?? null); setRef(''); setNote('') } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const label: Record<Match['status'], string> = { open: t('Waiting for review'), reported: t('Reported'), released: t('Released: false match'), closed: t('Closed') }
  const tone: Record<Match['status'], string> = { open: 'bg-danger/20 text-danger', reported: 'bg-accent/20 text-accent', released: 'bg-bg-3 text-text-1', closed: 'bg-bg-3 text-text-1' }
  return (
    <div className="max-w-3xl space-y-4" data-admin-matches>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldAlert size={22} className="text-danger" />{t('Matched uploads')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Uploads that matched known abuse material. Each was refused, the file is held in quarantine and the account was suspended. The file is never shown here. File the report your law requires with the authority (in the United States, the NCMEC CyberTipline), then record its reference.')}</p>
      </div>
      {list === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {list?.length === 0 && <p className="rounded-xl border border-line p-4 text-sm text-text-2" data-matches-empty>{t('No uploads have matched.')}</p>}
      {list?.map((m) => (
        <div key={m.id} className="rounded-xl border border-line" data-match={m.id} data-match-status={m.status}>
          <button type="button" onClick={() => { setOpen(open === m.id ? null : m.id); setRef(''); setNote('') }} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${tone[m.status]}`} data-match-label>{label[m.status]}</span>
            <span className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold">{m.username || t('Deleted account')}</span> <span className="text-text-2">· {m.surface} · {formatTime(m.created_at)}</span></span>
            {m.legal_hold && <span className="shrink-0 rounded-md bg-warn/20 px-2 py-0.5 text-[11px] font-bold uppercase text-warn" data-match-hold>{t('Legal hold')}</span>}
          </button>
          {open === m.id && (
            <div className="space-y-3 border-t border-line px-4 py-3 text-sm" data-match-detail>
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-text-2">{t('Account')}</dt><dd>{m.user_id ? <Link className="text-accent hover:underline" to={`/admin/users/${m.user_id}`}>{m.username}</Link> : (m.username || t('Deleted account'))}{m.suspended && <span className="ml-2 text-text-2">({t('suspended by this match')})</span>}</dd>
                <dt className="text-text-2">{t('Matched by')}</dt><dd data-match-source>{m.source}{m.category ? ` · ${m.category}` : ''}{m.reference ? ` · ${m.reference}` : ''}</dd>
                <dt className="text-text-2">{t('File')}</dt><dd className="break-all">{m.filename || t('(no name)')} · {m.content_type} · {m.size.toLocaleString()} {t('bytes')}</dd>
                <dt className="text-text-2">SHA-256</dt><dd className="break-all font-mono text-xs">{m.sha256}</dd>
                <dt className="text-text-2">{t('Sent from')}</dt><dd className="break-all">{m.ip || t('unknown')}{m.user_agent ? ` · ${m.user_agent}` : ''}</dd>
                <dt className="text-text-2">{t('Where')}</dt><dd className="break-all">{m.channel_id ? `${t('channel')} ${m.channel_id}${m.guild_id ? ` · ${t('server')} ${m.guild_id}` : ` · ${t('a direct message')}`}` : m.surface}</dd>
                <dt className="text-text-2">{t('Evidence')}</dt><dd>{m.quarantined ? t('The file is held in quarantine.') : t('No file is held.')}</dd>
                {m.report_ref && <><dt className="text-text-2">{t('Report')}</dt><dd data-match-ref>{m.report_ref}{m.reported_at ? ` · ${formatTime(m.reported_at)}` : ''}</dd></>}
                {m.note && <><dt className="text-text-2">{t('Note')}</dt><dd className="whitespace-pre-wrap">{m.note}</dd></>}
              </dl>
              {(m.status === 'open' || m.status === 'reported') && (
                <div className="space-y-2 rounded-lg bg-bg-0/50 p-3">
                  {m.status === 'open' && <>
                    <label className="block"><span className="label">{t('Reference of the report you filed')}</span><input className="input w-full" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('The number the authority gave you')} data-match-ref-input /></label>
                    <button type="button" className="btn-primary" disabled={!ref.trim()} onClick={() => act(m.id, 'reported', { report_ref: ref, note })} data-match-reported>{t('Record the report')}</button>
                  </>}
                  <label className="block"><span className="label">{t('Note')}</span><textarea className="input h-16 w-full" value={note} onChange={(e) => setNote(e.target.value)} data-match-note /></label>
                  <div className="flex flex-wrap gap-2">
                    {m.status === 'reported' && <button type="button" className="btn-primary" onClick={() => act(m.id, 'close', { note })} data-match-close>{t('Close')}</button>}
                    {m.status === 'open' && <button type="button" className="btn-ghost" disabled={!note.trim() || m.legal_hold} title={m.legal_hold ? t('Lift the legal hold first') : t('Restores the account and destroys the file')} onClick={() => act(m.id, 'release', { note })} data-match-release>{t('Release as a false match')}</button>}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={() => act(m.id, m.legal_hold ? 'unhold' : 'hold')} data-match-hold-toggle>{m.legal_hold ? t('Lift the legal hold') : t('Put on legal hold')}</button>
                {m.status === 'closed' && m.quarantined && <button type="button" className="btn-ghost text-danger" disabled={m.legal_hold} title={m.legal_hold ? t('Lift the legal hold first') : undefined} onClick={() => act(m.id, 'destroy')} data-match-destroy>{t('Destroy the quarantined file')}</button>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
