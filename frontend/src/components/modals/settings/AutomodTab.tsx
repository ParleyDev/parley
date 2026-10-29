import { AtSign, Link2, Plus, ShieldAlert, Trash2, UserX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { EMPTY_ROLES, sortedRoles } from '../../../lib/perms'
import { useStore } from '../../../store'
import { t, useT } from '../../../lib/i18n'

interface Rule { id: string; name: string; enabled: boolean; trigger: 'keyword' | 'mention_spam' | 'link_spam' | 'name'; keywords: string[]; regexes: string[]; allow: string[]; mention_limit: number; block: boolean; block_message: string; alert_channel_id: string | null; timeout_secs: number; exempt_roles: string[]; exempt_channels: string[] }
const kinds = (): { trigger: Rule['trigger']; label: string; desc: string; icon: React.ReactNode }[] => [
  { trigger: 'keyword', label: t('Block words'), desc: t('Words, phrases and patterns members can’t post.'), icon: <ShieldAlert size={18} /> },
  { trigger: 'mention_spam', label: t('Block mention spam'), desc: t('Messages that mention too many people or roles.'), icon: <AtSign size={18} /> },
  { trigger: 'link_spam', label: t('Block links'), desc: t('Links to sites that aren’t on an allowed list.'), icon: <Link2 size={18} /> },
  { trigger: 'name', label: t('Filter nicknames'), desc: t('Words members can’t use in their server nickname.'), icon: <UserX size={18} /> },
]
const timeouts = () => [[0, t('No timeout')], [60, t('1 minute')], [300, t('5 minutes')], [600, t('10 minutes')], [3600, t('1 hour')], [86400, t('1 day')], [604800, t('1 week')]] as const
const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

/** Server Settings › AutoMod: rules that block, flag or time out on posts and nicknames. */
export default function AutomodTab({ guildId }: { guildId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const channels = useStore((s) => s.channels)
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const textChannels = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind === 'text').sort((a, b) => a.position - b.position), [channels, guildId])
  const load = () => api.get<Rule[]>(`/guilds/${guildId}/automod`).then(setRules).catch(() => setRules([]))
  useEffect(() => { void load() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  const create = async (trigger: Rule['trigger']) => { try { const r = await api.post<Rule>(`/guilds/${guildId}/automod`, { trigger }); await load(); setOpen(r.id) } catch (e) { pushToast((e as Error).message, 'error') } }
  const save = async (r: Rule, patch: Partial<Rule>) => { try { const u = await api.patch<Rule>(`/guilds/${guildId}/automod/${r.id}`, patch); setRules((rs) => (rs ?? []).map((x) => (x.id === r.id ? u : x))); pushToast(t('AutoMod rule saved')) } catch (e) { pushToast((e as Error).message, 'error') } }
  const del = async (r: Rule) => { try { await api.delete(`/guilds/${guildId}/automod/${r.id}`); setRules((rs) => (rs ?? []).filter((x) => x.id !== r.id)) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-6" data-automod-tab>
      <div>
        <h1 className="text-xl font-bold">{t('AutoMod')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Stop unwanted messages and nicknames automatically. People who can manage the server are never filtered.')}</p>
      </div>
      <div className="grid grid-cols-2 phone:grid-cols-1 gap-2">
        {kinds().map((k) => (
          <button key={k.trigger} type="button" onClick={() => create(k.trigger)} className="flex items-start gap-3 rounded-xl border border-line bg-bg-1 p-3 text-left hover:border-text-2" data-automod-new={k.trigger}>
            <span className="mt-0.5 text-text-2">{k.icon}</span><span><span className="flex items-center gap-1 font-semibold text-sm">{k.label} <Plus size={13} /></span><span className="block text-xs text-text-2">{k.desc}</span></span>
          </button>
        ))}
      </div>
      {rules === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      <div className="space-y-2">
        {rules?.map((r) => <RuleCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onSave={(p) => save(r, p)} onDelete={() => del(r)} textChannels={textChannels} roles={sortedRoles(roles).filter((x) => x.id !== guildId)} />)}
      </div>
    </div>
  )
}

function RuleCard({ r, open, onToggle, onSave, onDelete, textChannels, roles }: { r: Rule; open: boolean; onToggle: () => void; onSave: (p: Partial<Rule>) => void; onDelete: () => void; textChannels: { id: string; name: string }[]; roles: { id: string; name: string }[] }) {
  const t = useT()
  const [d, setD] = useState({ ...r, kw: r.keywords.join('\n'), rx: r.regexes.join('\n'), al: r.allow.join('\n') })
  useEffect(() => setD({ ...r, kw: r.keywords.join('\n'), rx: r.regexes.join('\n'), al: r.allow.join('\n') }), [r])
  const kind = kinds().find((k) => k.trigger === r.trigger)
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <div className="rounded-xl border border-line bg-bg-1" data-automod-rule={r.id} data-automod-trigger={r.trigger}>
      <div className="flex items-center gap-3 p-3">
        <span className="text-text-2">{kind?.icon}</span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left"><span className="block truncate font-semibold">{r.name}</span><span className="block text-xs text-text-2">{kind?.label}{r.block ? ` · ${t('blocks')}` : ` · ${t('flags')}`}{r.alert_channel_id ? ` · ${t('alerts')}` : ''}{r.timeout_secs ? ` · ${t('times out')}` : ''}</span></button>
        <input type="checkbox" className="h-5 w-5 accent-accent" checked={r.enabled} onChange={(e) => onSave({ enabled: e.target.checked })} title={t('Enabled')} data-automod-enabled />
      </div>
      {open && (
        <div className="space-y-4 border-t border-line p-3 text-sm">
          <div><label className="label">{t('Rule name')}</label><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={100} /></div>
          {(r.trigger === 'keyword' || r.trigger === 'name') && (
            <>
              <div><label className="label">{t('Words and phrases')}</label><textarea className="input resize-y font-mono text-xs" rows={4} value={d.kw} onChange={(e) => setD({ ...d, kw: e.target.value })} placeholder={t('one per line\nword*  starts with\n*word  ends with\n*word*  anywhere')} data-automod-keywords /></div>
              <div><label className="label">{t('Regex patterns')} <span className="normal-case font-normal text-text-2">{t('(optional, up to 10)')}</span></label><textarea className="input resize-y font-mono text-xs" rows={2} value={d.rx} onChange={(e) => setD({ ...d, rx: e.target.value })} placeholder="c[a@]sh\s*app" data-automod-regexes /></div>
            </>
          )}
          {r.trigger === 'mention_spam' && <div><label className="label">{t('Most mentions in one message')}</label><input type="number" min={1} max={50} className="input w-24" value={d.mention_limit} onChange={(e) => setD({ ...d, mention_limit: Number(e.target.value) })} data-automod-mention-limit /></div>}
          {r.trigger !== 'mention_spam' && <div><label className="label">{r.trigger === 'link_spam' ? t('Allowed sites') : t('Allowed words')}</label><textarea className="input resize-y font-mono text-xs" rows={2} value={d.al} onChange={(e) => setD({ ...d, al: e.target.value })} placeholder={r.trigger === 'link_spam' ? 'youtube.com\ngithub.com' : t('one per line')} data-automod-allow /></div>}
          <div className="space-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={d.block} onChange={(e) => setD({ ...d, block: e.target.checked })} data-automod-block /> {r.trigger === 'name' ? t('Block the nickname') : t('Block the message')}</label>
            {d.block && <input className="input" value={d.block_message} onChange={(e) => setD({ ...d, block_message: e.target.value })} maxLength={150} placeholder={t('Custom message shown to the member (optional)')} data-automod-block-message />}
            <label className="flex items-center gap-2">{t('Send an alert to')}
              <select className="input w-auto py-1" value={d.alert_channel_id ?? ''} onChange={(e) => setD({ ...d, alert_channel_id: e.target.value || null })} data-automod-alert><option value="">{t('no channel')}</option>{textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
            </label>
            <label className="flex items-center gap-2">{t('Then')}
              <select className="input w-auto py-1" value={d.timeout_secs} onChange={(e) => setD({ ...d, timeout_secs: Number(e.target.value) })} data-automod-timeout>{timeouts().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
          </div>
          <div>
            <label className="label">{t('Exempt roles')}</label>
            <div className="flex flex-wrap gap-1.5">{roles.map((x) => <button key={x.id} type="button" onClick={() => setD({ ...d, exempt_roles: toggleIn(d.exempt_roles, x.id) })} className={`rounded-full border px-2 py-0.5 text-xs ${d.exempt_roles.includes(x.id) ? 'border-accent bg-accent/20' : 'border-line'}`} data-automod-exempt-role={x.id}>{x.name}</button>)}</div>
            {r.trigger !== 'name' && <><label className="label mt-2">{t('Exempt channels')}</label><div className="flex flex-wrap gap-1.5">{textChannels.map((c) => <button key={c.id} type="button" onClick={() => setD({ ...d, exempt_channels: toggleIn(d.exempt_channels, c.id) })} className={`rounded-full border px-2 py-0.5 text-xs ${d.exempt_channels.includes(c.id) ? 'border-accent bg-accent/20' : 'border-line'}`} data-automod-exempt-channel={c.id}>#{c.name}</button>)}</div></>}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => onSave({ name: d.name, keywords: lines(d.kw), regexes: d.rx.split('\n').map((x) => x.trim()).filter(Boolean), allow: lines(d.al), mention_limit: d.mention_limit, block: d.block, block_message: d.block_message, alert_channel_id: d.alert_channel_id, timeout_secs: d.timeout_secs, exempt_roles: d.exempt_roles, exempt_channels: d.exempt_channels })} data-automod-save>{t('Save Rule')}</button>
            <button type="button" className="btn-ghost text-danger ml-auto" onClick={onDelete} data-automod-delete><Trash2 size={14} /> {t('Delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
