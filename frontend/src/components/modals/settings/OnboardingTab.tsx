import { Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { EMPTY_ROLES, P, sortedRoles } from '../../../lib/perms'
import type { Onboarding, OnboardingQuestion } from '../../../lib/types'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

/** Roles an answer may never grant (mirrors perms::SELF_GRANT_FORBIDDEN). */
const FORBIDDEN = P.ADMINISTRATOR | P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_GUILD | P.MANAGE_MESSAGES | P.MANAGE_ROLES | P.MODERATE_MEMBERS | P.MANAGE_NICKNAMES | P.MUTE_MEMBERS | P.DEAFEN_MEMBERS | P.MOVE_MEMBERS | P.MANAGE_THREADS | P.MANAGE_EVENTS | P.MANAGE_EXPRESSIONS | P.VIEW_AUDIT_LOG | P.MENTION_EVERYONE

/** Server Settings › Onboarding: questions new members answer; answers give roles and show channels. */
export default function OnboardingTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const channels = useStore((s) => s.channels)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const chans = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind !== 'category' && c.kind !== 'thread').sort((a, b) => a.position - b.position), [channels, guildId])
  const grantable = sortedRoles(roles).filter((r) => r.id !== guildId && (r.permissions & FORBIDDEN) === 0)
  const [enabled, setEnabled] = useState(!!guild?.onboarding?.enabled)
  const [qs, setQs] = useState<OnboardingQuestion[]>(guild?.onboarding?.questions ?? [])
  const [busy, setBusy] = useState(false)
  const t = useT()
  if (!guild) return null
  const setQ = (i: number, patch: Partial<OnboardingQuestion>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const setO = (i: number, k: number, patch: Partial<OnboardingQuestion['options'][number]>) => setQ(i, { options: qs[i].options.map((o, j) => (j === k ? { ...o, ...patch } : o)) })
  const save = async () => {
    setBusy(true)
    try {
      const v = await api.put<Onboarding>(`/guilds/${guildId}/onboarding`, { enabled, questions: qs })
      upsertGuild({ ...guild, onboarding: v }); setQs(v.questions ?? []); pushToast(t('Onboarding saved'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-6" data-onboarding-tab>
      <div>
        <h1 className="text-xl font-bold">{t('Onboarding')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Ask new members a few questions. Their answers give them roles and show them channels. Members can change roles they can pick themselves under Channels & Roles.')}</p>
      </div>
      <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
        <span className="text-sm font-semibold">{t('Ask new members these questions')}</span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-accent" data-onboarding-enabled />
      </label>
      {qs.map((q, i) => (
        <section key={q.id ?? i} className="space-y-3 rounded-xl border border-line bg-bg-1 p-4" data-onboarding-q={i}>
          <div className="flex gap-2">
            <input className="input flex-1" value={q.title} maxLength={100} onChange={(e) => setQ(i, { title: e.target.value })} placeholder={t('What brings you here?')} data-onboarding-title={i} />
            <button type="button" className="text-text-2 hover:text-danger" title={t('Remove question')} onClick={() => setQs(qs.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-accent" checked={q.multi} onChange={(e) => setQ(i, { multi: e.target.checked })} />{t('Allow several answers')}</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-accent" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} data-onboarding-required={i} />{t('Required')}</label>
          </div>
          {q.options.map((o, k) => (
            <div key={o.id ?? k} className="flex flex-wrap gap-2 rounded-lg bg-bg-2 p-2" data-onboarding-opt={`${i}-${k}`}>
              <input className="input w-12 px-0 text-center" value={o.emoji} maxLength={32} onChange={(e) => setO(i, k, { emoji: e.target.value })} placeholder="✨" aria-label={t('Emoji')} />
              <input className="input min-w-0 flex-1" value={o.label} maxLength={50} onChange={(e) => setO(i, k, { label: e.target.value })} placeholder={t('Answer')} data-onboarding-label={`${i}-${k}`} />
              <button type="button" className="text-text-2 hover:text-danger" title={t('Remove answer')} onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })}><X size={16} /></button>
              <div className="flex w-full flex-wrap gap-2 text-xs">
                <select className="input w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && setO(i, k, { role_ids: [...o.role_ids, e.target.value] })} data-onboarding-addrole={`${i}-${k}`}>
                  <option value="">{t('+ Role')}</option>
                  {grantable.filter((r) => !o.role_ids.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select className="input w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && setO(i, k, { channel_ids: [...o.channel_ids, e.target.value] })} data-onboarding-addchan={`${i}-${k}`}>
                  <option value="">{t('+ Channel')}</option>
                  {chans.filter((c) => !o.channel_ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
                {o.role_ids.map((r) => <span key={r} className="flex items-center gap-1 rounded-full bg-bg-4 px-2 py-0.5">@{roles[r]?.name ?? 'role'}<button type="button" onClick={() => setO(i, k, { role_ids: o.role_ids.filter((x) => x !== r) })}><X size={12} /></button></span>)}
                {o.channel_ids.map((c) => <span key={c} className="flex items-center gap-1 rounded-full bg-bg-4 px-2 py-0.5">#{channels[c]?.name ?? 'channel'}<button type="button" onClick={() => setO(i, k, { channel_ids: o.channel_ids.filter((x) => x !== c) })}><X size={12} /></button></span>)}
              </div>
            </div>
          ))}
          {q.options.length < 10 && <button type="button" className="flex items-center gap-1 text-sm text-sky-400 hover:underline" onClick={() => setQ(i, { options: [...q.options, { label: '', emoji: '', role_ids: [], channel_ids: [] }] })} data-onboarding-addopt={i}><Plus size={14} />{t('Add answer')}</button>}
        </section>
      ))}
      {qs.length < 5 && <button type="button" className="btn-ghost flex items-center gap-1" onClick={() => setQs([...qs, { title: '', multi: false, required: false, options: [{ label: '', emoji: '', role_ids: [], channel_ids: [] }] }])} data-onboarding-addq><Plus size={16} />{t('Add question')}</button>}
      <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy} onClick={save} data-onboarding-save>{t('Save')}</button></div>
    </div>
  )
}
