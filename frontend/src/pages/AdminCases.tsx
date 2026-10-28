import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { can, useAccess } from './adminAccess'

interface Case { id: string; kind: 'report' | 'investigation' | 'legal'; subject_kind: string; subject_id: string; report_id: string | null; anchor_message_id: string | null; opened_by: string | null; justification: string; status: 'open' | 'closed'; scope_channel_ids: string[]; scope_from: string | null; scope_to: string | null; expires_at: string; created_at: string }
interface Grant { id: string; case_id: string; kind: 'expand' | 'private_access' | 'export'; requested_by: string; justification: string; channel_ids: string[]; status: 'pending' | 'approved' | 'denied' | 'revoked'; decided_by: string | null; expires_at: string | null; created_at: string }
interface Scope { id: string; name: string | null; private: boolean | null }
interface Msg { id: string; channel_id: string; content: string; created_at: string; author: { id: string; username: string; display_name: string }; attachments?: { id: string; filename: string; url: string }[] }

const MIN_WHY = 10

/** A search result before anyone opens it: who, where, when. No content. */
export interface MetaHit { id: string; channel_id: string; channel_name: string; guild_id: string | null; guild_name: string | null; author_id: string; author_username: string; created_at: string; has_attachments: boolean }
export interface OpenedMsg { id: string; content: string; attachments?: { id: string; filename: string; url: string }[] }

/** One search result: metadata first; opening its content is a separate, logged action. */
export function MetaRow({ h, open, onDeleted }: { h: MetaHit; open: () => Promise<OpenedMsg>; onDeleted?: () => void }) {
  const t = useT()
  const a = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [m, setM] = useState<OpenedMsg | null>(null)
  const show = async () => { try { setM(await open()) } catch (e) { pushToast((e as Error).message, 'error') } }
  const del = async () => { try { await api.delete(`/admin/messages/${h.id}`); pushToast(t('Message deleted')); onDeleted?.() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="px-3 py-2 border-t border-line first:border-t-0 text-sm" data-admin-msg={h.id}>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-2">
        <span className="font-semibold text-text-0">@{h.author_username}</span>
        <span>{h.guild_id ? `${h.guild_name ?? ''} · #${h.channel_name}` : t('Direct message')}</span>
        <span title={h.created_at}>{new Date(h.created_at).toLocaleString()}</span>
        {h.has_attachments && <span>📎</span>}
        <span className="ml-auto flex gap-3">
          {!m && <button type="button" onClick={show} className="text-sky-400 hover:underline" data-admin-msg-open>{t('Open')}</button>}
          {can(a, 'content_action') && onDeleted && <button type="button" onClick={del} className="text-danger hover:underline" data-admin-msg-delete>{t('Delete')}</button>}
        </span>
      </div>
      {m && <div className="whitespace-pre-wrap break-words mt-0.5" data-admin-msg-content>{m.content || <i className="text-text-2">{t('(no text)')}</i>}</div>}
      {m?.attachments && m.attachments.length > 0 && <div className="text-xs text-text-2 mt-0.5">📎 {m.attachments.map((x) => <a key={x.id} className="hover:underline mr-2" href={x.url} target="_blank" rel="noreferrer">{x.filename}</a>)}</div>}
    </div>
  )
}


/** Admin › Cases: every route to message content. Reports open cases; investigations and legal cases are opened here. */
export default function CasesPane() {
  const t = useT()
  const a = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open')
  const [rows, setRows] = useState<Case[] | null>(null)
  const [pending, setPending] = useState<Grant[]>([])
  const [opening, setOpening] = useState(false)
  useEffect(() => { setRows(null); api.get<Case[]>(`/admin/cases?status=${status}`).then(setRows).catch((e) => pushToast((e as Error).message, 'error')) }, [status, pushToast])
  useEffect(() => { if (can(a, 'case_approve')) api.get<Grant[]>('/admin/case-grants').then(setPending).catch(() => {}) }, [a])
  const kindLabel = { report: t('Report'), investigation: t('Investigation'), legal: t('Legal') }
  return (
    <div data-admin-cases>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{t('Cases')}</h1>
        {can(a, 'content_search_public', 'content_export') && <button type="button" className="btn-primary py-1.5 text-sm ml-auto" onClick={() => setOpening(true)} data-case-new>{t('Open a case')}</button>}
      </div>
      <p className="text-sm text-text-2 mt-1">{t('Admins read messages only through a case. Reports open one each; going past the context window, into a DM or group chat, or exporting needs a second person to approve.')}</p>
      {opening && <OpenCase onClose={() => setOpening(false)} />}
      {pending.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3" data-case-pending>
          <div className="text-sm font-semibold">{t('Waiting for your approval')}</div>
          {pending.map((g) => <NavLink key={g.id} to={`/admin/cases/${g.case_id}`} className="mt-1 block text-sm text-sky-400 hover:underline" data-case-pending-grant={g.id}>{grantLabel(t, g.kind)}: {g.justification}</NavLink>)}
        </div>
      )}
      <div className="mt-4 flex gap-1.5">
        {(['open', 'closed', 'all'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs font-semibold ${status === s ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-case-filter={s}>{{ open: t('open'), closed: t('closed'), all: t('all') }[s]}</button>)}
      </div>
      <div className="mt-3 rounded-xl border border-line overflow-hidden">
        {rows === null && <p className="p-4 text-sm text-text-2">{t('Loading…')}</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-text-2">{t('No cases.')}</p>}
        {rows?.map((c) => (
          <NavLink key={c.id} to={`/admin/cases/${c.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-line first:border-t-0 hover:bg-bg-3/40 text-sm" data-case-row={c.id}>
            <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold uppercase">{kindLabel[c.kind]}</span>
            <span className="min-w-0 flex-1 truncate">{c.justification}</span>
            <span className="text-xs text-text-2">{new Date(c.created_at).toLocaleDateString()}</span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}

const grantLabel = (t: ReturnType<typeof useT>, k: Grant['kind']) => ({ expand: t('Expand context'), private_access: t('DM / group access'), export: t('Export') }[k])

function OpenCase({ onClose }: { onClose: () => void }) {
  const t = useT()
  const a = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const [kind, setKind] = useState<'investigation' | 'legal'>(can(a, 'content_search_public') ? 'investigation' : 'legal')
  const [subjectKind, setSubjectKind] = useState('user')
  const [subject, setSubject] = useState('')
  const [channels, setChannels] = useState('')
  const [why, setWhy] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const c = await api.post<Case>('/admin/cases', { kind, subject_kind: subjectKind, subject_id: subject.trim(), justification: why.trim(), channel_ids: channels.split(/[\s,]+/).filter(Boolean), from: from ? new Date(from).toISOString() : null, to: to ? new Date(to).toISOString() : null })
      window.location.assign(`/admin/cases/${c.id}`)
    } catch (err) { pushToast((err as Error).message, 'error') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={onClose} data-case-open-dialog>
      <form className="pop w-full max-w-lg rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="text-lg font-bold">{t('Open a case')}</h3>
        <div className="flex gap-2">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'investigation' | 'legal')} data-case-kind>
            {can(a, 'content_search_public') && <option value="investigation">{t('Investigation')}</option>}
            {can(a, 'content_export') && <option value="legal">{t('Legal')}</option>}
          </select>
          <select className="input" value={subjectKind} onChange={(e) => setSubjectKind(e.target.value)} data-case-subject-kind>
            <option value="user">{t('User')}</option><option value="conversation">{t('Conversation')}</option><option value="server">{t('Server')}</option>
          </select>
        </div>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('Subject ID')} data-case-subject />
        <input className="input" value={channels} onChange={(e) => setChannels(e.target.value)} placeholder={t('Channel IDs in scope (comma separated)')} data-case-channels />
        <div className="flex gap-2 text-xs text-text-2 items-center">{t('From')} <input type="datetime-local" className="input py-1" value={from} onChange={(e) => setFrom(e.target.value)} /> {t('to')} <input type="datetime-local" className="input py-1" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <textarea className="input min-h-[70px]" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('Why this case is needed')} data-case-why />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost py-1.5" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn-primary py-1.5" disabled={why.trim().length < MIN_WHY || !subject.trim() || !channels.trim()} data-case-open-go>{t('Open case')}</button></div>
      </form>
    </div>
  )
}

/** One case: its scope, the report's context window, grants (request, approve), and reading within scope. */
export function CasePane() {
  const t = useT()
  const { id } = useParams()
  const a = useAccess()
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<{ case: Case; grants: Grant[]; scope: Scope[]; context_window: number } | null>(null)
  const [ctx, setCtx] = useState<{ anchor_id: string; messages: Msg[] } | null>(null)
  const [ctxErr, setCtxErr] = useState('')
  const [reading, setReading] = useState<{ channel: string; messages: Msg[] } | null>(null)
  const [readErr, setReadErr] = useState('')
  const [req, setReq] = useState<{ kind: Grant['kind']; why: string } | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<MetaHit[] | null>(null)
  const [searchErr, setSearchErr] = useState('')
  const load = () => api.get<{ case: Case; grants: Grant[]; scope: Scope[]; context_window: number }>(`/admin/cases/${id}`).then(setData).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const c = data.case
  const live = c.status === 'open' && new Date(c.expires_at) > new Date()
  const showContext = async () => { setCtxErr(''); try { setCtx(await api.get(`/admin/cases/${c.id}/context`)) } catch (e) { setCtxErr((e as Error).message) } }
  const read = async (channel: string, before?: string) => {
    setReadErr('')
    try {
      const msgs = await api.get<Msg[]>(`/admin/cases/${c.id}/messages?channel_id=${channel}${before ? `&before=${before}` : ''}`)
      setReading((r) => ({ channel, messages: before && r?.channel === channel ? [...msgs, ...r.messages] : msgs }))
    } catch (e) { setReadErr((e as Error).message) }
  }
  const search = async (e: FormEvent) => {
    e.preventDefault(); setSearchErr('')
    try { setHits(await api.get<MetaHit[]>(`/admin/cases/${c.id}/search?q=${encodeURIComponent(q.trim())}`)) } catch (err) { setHits(null); setSearchErr((err as Error).message) }
  }
  const ask = async (e: FormEvent) => {
    e.preventDefault(); if (!req) return
    try { await api.post(`/admin/cases/${c.id}/grants`, { kind: req.kind, justification: req.why.trim() }); pushToast(t('Request sent: another T&S lead has to approve it')); setReq(null); load() } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const decide = async (g: Grant, decision: 'approve' | 'deny' | 'revoke') => { try { await api.post(`/admin/cases/${c.id}/grants/${g.id}`, { decision }); load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const close = async () => { try { await api.post(`/admin/cases/${c.id}/close`); load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const exportCase = async () => {
    try {
      const body = await api.get(`/admin/cases/${c.id}/export`)
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `case-${c.id}.json`; link.click(); URL.revokeObjectURL(url)
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const myApproved = (k: Grant['kind']) => data.grants.some((g) => g.kind === k && g.status === 'approved' && g.requested_by === me?.id && g.expires_at && new Date(g.expires_at) > new Date())
  const kinds: Grant['kind'][] = ([['expand', 'report_context_expand'], ['private_access', 'content_search_private'], ['export', 'content_export']] as const).filter(([, p]) => can(a, p)).map(([k]) => k)
  return (
    <div data-case={c.id} data-case-status={c.status}>
      <NavLink to="/admin/cases" className="text-sm text-sky-400 hover:underline">← {t('Cases')}</NavLink>
      <h1 className="mt-2 text-2xl font-bold">{{ report: t('Report case'), investigation: t('Investigation'), legal: t('Legal case') }[c.kind]}</h1>
      <div className="mt-1 text-sm text-text-2">{c.justification}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
        <span>{c.status === 'open' ? t('Open') : t('Closed')}</span>
        <span>{t('Expires {date}', { date: new Date(c.expires_at).toLocaleString() })}</span>
        {c.scope_from && <span>{t('From {date}', { date: new Date(c.scope_from).toLocaleString() })}</span>}
        {c.scope_to && <span>{t('Until {date}', { date: new Date(c.scope_to).toLocaleString() })}</span>}
        {c.report_id && <NavLink to="/admin/reports" className="text-sky-400 hover:underline">{t('Report')}</NavLink>}
        {c.status === 'open' && <button type="button" className="text-sky-400 hover:underline" onClick={close} data-case-close>{t('Close case')}</button>}
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-text-2">{t('Scope')}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {data.scope.map((s) => (
          <button key={s.id} type="button" disabled={!live} onClick={() => read(s.id)} className={`rounded-lg border px-2.5 py-1 text-sm ${reading?.channel === s.id ? 'border-accent' : 'border-line'} hover:bg-bg-3`} data-case-scope={s.id}>
            {s.name === null ? t('Deleted conversation') : s.private ? t('DM / group: {name}', { name: s.name || t('unnamed') }) : `#${s.name}`}
          </button>
        ))}
      </div>

      {live && (
        <form onSubmit={search} className="mt-4 flex gap-2 max-w-xl" data-case-search-form>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search within this case')} data-case-search />
          <button type="submit" className="btn-ghost py-1.5" disabled={!q.trim()} data-case-search-go>{t('Search')}</button>
        </form>
      )}
      {searchErr && <p className="mt-2 text-sm text-danger" data-case-search-error>{searchErr}</p>}
      {hits && (
        <div className="mt-2 rounded-xl border border-line" data-case-hits>
          {hits.length === 0 && <p className="p-3 text-sm text-text-2">{t('No messages match.')}</p>}
          {hits.map((h) => <MetaRow key={h.id} h={h} open={() => api.post<OpenedMsg>(`/admin/cases/${c.id}/messages/${h.id}/open`)} />)}
        </div>
      )}

      {c.anchor_message_id && live && (
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-2">{t('Context ({n} either side)', { n: data.context_window })}</h2>
            {!ctx && <button type="button" className="btn-ghost py-1 text-xs" onClick={showContext} data-case-context-show>{t('Show')}</button>}
          </div>
          {ctxErr && <p className="mt-2 text-sm text-danger" data-case-context-error>{ctxErr}</p>}
          {ctx && <div className="mt-2 rounded-xl border border-line" data-case-context>{ctx.messages.map((m) => <Row key={m.id} m={m} hl={m.id === ctx.anchor_id} />)}</div>}
        </div>
      )}

      {reading && (
        <div className="mt-6" data-case-reading={reading.channel}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-2">{t('Messages')}</h2>
          <div className="mt-2 rounded-xl border border-line">
            {reading.messages.length > 0 && <button type="button" className="w-full py-1.5 text-xs text-sky-400 hover:bg-bg-3" onClick={() => read(reading.channel, reading.messages[0].id)} data-case-older>{t('Older')}</button>}
            {reading.messages.length === 0 && <p className="p-3 text-sm text-text-2">{t('No messages in scope.')}</p>}
            {reading.messages.map((m) => <Row key={m.id} m={m} />)}
          </div>
        </div>
      )}
      {readErr && <p className="mt-3 text-sm text-danger" data-case-read-error>{readErr}</p>}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-text-2">{t('Grants')}</h2>
      <div className="mt-2 space-y-2">
        {data.grants.length === 0 && <p className="text-sm text-text-2">{t('None yet.')}</p>}
        {data.grants.map((g) => (
          <div key={g.id} className="rounded-lg border border-line px-3 py-2 text-sm" data-case-grant={g.id} data-grant-status={g.status} data-grant-kind={g.kind}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{grantLabel(t, g.kind)}</span>
              <span className="rounded bg-bg-3 px-1.5 text-[10px] font-bold uppercase">{{ pending: t('pending'), approved: t('approved'), denied: t('denied'), revoked: t('revoked') }[g.status]}</span>
              {g.requested_by === me?.id && <span className="text-xs text-text-2">{t('your request')}</span>}
              {g.status === 'approved' && g.expires_at && <span className="text-xs text-text-2">{t('until {date}', { date: new Date(g.expires_at).toLocaleString() })}</span>}
              {can(a, 'case_approve') && g.requested_by !== me?.id && g.status === 'pending' && (
                <span className="ml-auto flex gap-1.5">
                  <button type="button" className="btn-primary py-0.5 text-xs" onClick={() => decide(g, 'approve')} data-grant-approve>{t('Approve')}</button>
                  <button type="button" className="btn-ghost py-0.5 text-xs" onClick={() => decide(g, 'deny')} data-grant-deny>{t('Deny')}</button>
                </span>
              )}
              {can(a, 'case_approve') && g.requested_by !== me?.id && g.status === 'approved' && <button type="button" className="ml-auto btn-ghost py-0.5 text-xs" onClick={() => decide(g, 'revoke')} data-grant-revoke>{t('Revoke')}</button>}
            </div>
            <div className="text-xs text-text-2 mt-0.5">{g.justification}</div>
          </div>
        ))}
      </div>
      {live && kinds.length > 0 && (req ? (
        <form onSubmit={ask} className="mt-3 flex flex-wrap gap-2 items-center" data-case-request-form>
          <select className="input w-auto" value={req.kind} onChange={(e) => setReq({ ...req, kind: e.target.value as Grant['kind'] })} data-case-request-kind>{kinds.map((k) => <option key={k} value={k}>{grantLabel(t, k)}</option>)}</select>
          <input className="input flex-1 min-w-[200px]" value={req.why} onChange={(e) => setReq({ ...req, why: e.target.value })} placeholder={t('Why you need it')} data-case-request-why />
          <button type="submit" className="btn-primary py-1.5" disabled={req.why.trim().length < MIN_WHY} data-case-request-go>{t('Request')}</button>
        </form>
      ) : <button type="button" className="mt-3 btn-ghost py-1.5 text-sm" onClick={() => setReq({ kind: kinds[0], why: '' })} data-case-request>{t('Request access')}</button>)}
      {live && myApproved('export') && <button type="button" className="mt-3 ml-2 btn-primary py-1.5 text-sm" onClick={exportCase} data-case-export>{t('Export')}</button>}
    </div>
  )
}

function Row({ m, hl }: { m: Msg; hl?: boolean }) {
  return (
    <div className={`px-3 py-1.5 border-t border-line first:border-t-0 text-sm ${hl ? 'bg-warn/10' : ''}`} data-case-msg={m.id} data-anchor={hl ? '1' : undefined}>
      <div className="flex gap-2 text-xs text-text-2"><span className="font-semibold text-text-0">@{m.author.username}</span><span>{new Date(m.created_at).toLocaleString()}</span></div>
      <div className="whitespace-pre-wrap break-words">{m.content}</div>
      {m.attachments && m.attachments.length > 0 && <div className="text-xs text-text-2">📎 {m.attachments.map((x) => x.filename).join(', ')}</div>}
    </div>
  )
}
