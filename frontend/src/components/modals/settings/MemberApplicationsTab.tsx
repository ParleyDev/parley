import { Check, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { has, P } from '../../../lib/perms'
import type { ApplicationQuestion } from '../../../lib/types'
import { myGuildPerms, useStore } from '../../../store'
import Avatar from '../../Avatar'

interface Pending { user_id: string; answers: { question: string; answer: string }[]; created_at: string; user: { id: string; username: string; display_name: string; avatar_url: string | null; created_at: string } }

/** Server Settings › Applications: the questions new members answer, and the queue of applications to review. */
export default function MemberApplicationsTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const canForm = useStore((s) => has(myGuildPerms(s, guildId), P.MANAGE_GUILD))
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [enabled, setEnabled] = useState(!!guild?.applications?.enabled)
  const [qs, setQs] = useState<ApplicationQuestion[]>(guild?.applications?.questions ?? [])
  const [queue, setQueue] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Pending[]>(`/guilds/${guildId}/applications`).then(setQueue).catch(() => setQueue([])) }, [guildId])
  if (!guild) return null
  const setQ = (i: number, patch: Partial<ApplicationQuestion>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const save = async () => {
    setBusy(true)
    try { const v = await api.put<{ enabled: boolean; questions: ApplicationQuestion[] }>(`/guilds/${guildId}/application-form`, { enabled, questions: qs }); upsertGuild({ ...guild, applications: v }); setQs(v.questions); pushToast('Applications saved') } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const decide = async (p: Pending, ok: boolean) => {
    const reason = ok ? '' : (prompt(`Reason for rejecting ${p.user.display_name} (optional)`) ?? null)
    if (reason === null) return
    try { await api.post(`/guilds/${guildId}/applications/${p.user_id}/${ok ? 'approve' : 'reject'}`, ok ? {} : { reason }); setQueue(queue.filter((x) => x.user_id !== p.user_id)); pushToast(ok ? `${p.user.display_name} approved` : `${p.user.display_name} rejected`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="space-y-6" data-applications-tab>
      <div>
        <h1 className="text-xl font-bold">Applications</h1>
        <p className="mt-1 text-sm text-text-2">New members answer these questions and can only read until a moderator approves them. People already in the server aren't affected.</p>
      </div>
      <section>
        <h2 className="label">Waiting for review ({queue.length})</h2>
        {queue.length === 0 ? <p className="text-sm text-text-2">No applications waiting.</p> : (
          <div className="space-y-3">
            {queue.map((p) => (
              <div key={p.user_id} className="rounded-xl border border-line bg-bg-1 p-3" data-application={p.user_id}>
                <div className="flex items-center gap-2">
                  <Avatar user={p.user} size={32} /><div className="flex-1"><div className="font-semibold">{p.user.display_name}</div><div className="text-xs text-text-2">@{p.user.username} · account made {new Date(p.user.created_at).toLocaleDateString()}</div></div>
                  <button type="button" className="btn-primary flex items-center gap-1 py-1" onClick={() => decide(p, true)} data-application-approve={p.user_id}><Check size={14} />Approve</button>
                  <button type="button" className="btn-danger flex items-center gap-1 py-1" onClick={() => decide(p, false)} data-application-reject={p.user_id}><X size={14} />Reject</button>
                </div>
                <dl className="mt-2 space-y-1 text-sm">{p.answers.map((a, i) => <div key={i}><dt className="text-xs font-semibold text-text-2">{a.question}</dt><dd className="whitespace-pre-wrap text-text-1">{a.answer || <i className="text-text-2">No answer</i>}</dd></div>)}</dl>
              </div>
            ))}
          </div>
        )}
      </section>
      {canForm && (
        <section className="space-y-3">
          <h2 className="label">Application form</h2>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
            <span className="text-sm font-semibold">Review new members before they can chat</span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-accent" data-applications-enabled />
          </label>
          {qs.map((q, i) => (
            <div key={q.id ?? i} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-1 p-2" data-app-q={i}>
              <input className="input min-w-0 flex-1" value={q.title} maxLength={150} onChange={(e) => setQ(i, { title: e.target.value })} placeholder="Why do you want to join?" data-app-q-title={i} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-accent" checked={q.paragraph} onChange={(e) => setQ(i, { paragraph: e.target.checked })} />Long answer</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-accent" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />Required</label>
              <button type="button" className="text-text-2 hover:text-danger" title="Remove" onClick={() => setQs(qs.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          {qs.length < 5 && <button type="button" className="btn-ghost flex items-center gap-1" onClick={() => setQs([...qs, { title: '', paragraph: false, required: true }])} data-app-add><Plus size={16} />Add question</button>}
          <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy} onClick={save} data-applications-save>Save</button></div>
        </section>
      )}
    </div>
  )
}
