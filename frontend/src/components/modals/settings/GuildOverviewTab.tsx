import { Crown } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import ImagePicker from '../ImagePicker'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { Guild } from '../../../lib/types'
import { useT } from '../../../lib/i18n'

export default function GuildOverviewTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const me = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const ownerMember = useStore((s) => (guild ? s.members[guildId]?.[guild.owner_id] : undefined))
  const pushToast = useStore((s) => s.pushToast)
  const [name, setName] = useState(guild?.name ?? '')
  const [icon, setIcon] = useState<string | null>(guild?.icon_url ?? null)
  const [banner, setBanner] = useState<string | null>(guild?.banner_url ?? null)
  const [rules, setRules] = useState(guild?.rules ?? '')
  const [rulesRequired, setRulesRequired] = useState(!!guild?.rules_required)
  const [description, setDescription] = useState(guild?.description ?? '')
  const [systemChannel, setSystemChannel] = useState(guild?.system_channel_id ?? '')
  const [joinNotices, setJoinNotices] = useState(guild?.join_notices ?? true)
  const [joinWave, setJoinWave] = useState(guild?.join_wave ?? true)
  const [defaultNotif, setDefaultNotif] = useState<'all' | 'mentions'>(guild?.default_notifications ?? 'all')
  const [afkChannel, setAfkChannel] = useState(guild?.afk_channel_id ?? '')
  const [afkTimeout, setAfkTimeout] = useState(guild?.afk_timeout ?? 300)
  const [rulesChannel, setRulesChannel] = useState(guild?.rules_channel_id ?? '')
  const channels = useStore((s) => s.channels)
  const voiceChannels = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind === 'voice').sort((a, b) => a.position - b.position), [channels, guildId])
  const textChannels = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind === 'text').sort((a, b) => a.position - b.position), [channels, guildId])
  const [busy, setBusy] = useState(false)
  const t = useT()
  if (!guild) return null
  const extrasDirty = description !== (guild.description ?? '') || systemChannel !== (guild.system_channel_id ?? '') || joinNotices !== (guild.join_notices ?? true) || joinWave !== (guild.join_wave ?? true) || defaultNotif !== (guild.default_notifications ?? 'all')
    || afkChannel !== (guild.afk_channel_id ?? '') || afkTimeout !== (guild.afk_timeout ?? 300) || rulesChannel !== (guild.rules_channel_id ?? '')
  const dirty = extrasDirty || name !== guild.name || (icon ?? null) !== (guild.icon_url ?? null) || (banner ?? null) !== (guild.banner_url ?? null) || rules !== (guild.rules ?? '') || rulesRequired !== !!guild.rules_required
  const reset = () => {
    setName(guild.name); setIcon(guild.icon_url); setBanner(guild.banner_url ?? null); setRules(guild.rules ?? ''); setRulesRequired(!!guild.rules_required)
    setDescription(guild.description ?? ''); setSystemChannel(guild.system_channel_id ?? ''); setJoinNotices(guild.join_notices ?? true); setJoinWave(guild.join_wave ?? true); setDefaultNotif(guild.default_notifications ?? 'all')
    setAfkChannel(guild.afk_channel_id ?? ''); setAfkTimeout(guild.afk_timeout ?? 300); setRulesChannel(guild.rules_channel_id ?? '')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const g = await api.patch<Guild>(`/guilds/${guildId}`, { name, icon_url: icon ?? '', banner_url: banner ?? '', rules, rules_required: rulesRequired, description, system_channel_id: systemChannel || null, join_notices: joinNotices, join_wave: joinWave, default_notifications: defaultNotif, afk_channel_id: afkChannel || null, afk_timeout: afkTimeout, rules_channel_id: rulesChannel || null })
      upsertGuild(g); pushToast(t('Server updated'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-xl font-bold">{t('Server Overview')}</h1>
      <div className="flex items-start gap-6 phone:flex-col">
        <ImagePicker value={icon} onChange={setIcon} label={name} id={guildId} kind="icon" />
        <div className="flex-1 w-full"><label className="label">{t('Server name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      </div>
      <div>
        <label className="label" htmlFor="guild-description">{t('Description')}</label>
        <textarea id="guild-description" className="input resize-none" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('What\'s this server about?')} data-guild-description />
        <p className="mt-1 text-xs text-text-2">{t('Shown on invites and in Discover. {n} characters left.', { n: 300 - [...description].length })}</p>
      </div>
      <div>
        <label className="label">{t('Server banner')}</label>
        <div className="flex items-center gap-4"><ImagePicker value={banner} onChange={setBanner} label={name} id={guildId} round={false} kind="banner" /><p className="text-xs text-text-2">{t('Shown above the channel list and on your Discover card. GIF, APNG and WebP animations are kept.')}</p></div>
      </div>
      <div className="rounded-xl bg-bg-0/50 border border-line p-4">
        <div className="flex items-center gap-2 font-semibold"><Crown size={16} className="text-warn" /> {t('Server owner')}</div>
        <p className="text-sm text-text-2 mt-1">
          {guild.owner_id === me?.id ? t('You own this server. Transferring ownership hands over full control, including deleting the server.') : t('This server is owned by {name}.', { name: ownerMember ? (ownerMember.nickname ?? ownerMember.display_name) : t('another member') })}
        </p>
        {guild.owner_id === me?.id && <button type="button" className="btn-ghost mt-3" onClick={() => openModal({ kind: 'transferOwnership', guildId })}><Crown size={16} /> {t('Transfer Ownership')}</button>}
      </div>
      <section className="space-y-3" data-system-messages>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">{t('System messages')}</h2>
        <div>
          <label className="label" htmlFor="system-channel">{t('System messages channel')}</label>
          <select id="system-channel" className="input" value={systemChannel} onChange={(e) => setSystemChannel(e.target.value)} data-system-channel>
            <option value="">{t('First text channel')}{textChannels[0] ? ` (#${textChannels[0].name})` : ''}</option>
            {textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
          <span className="text-sm">{t('Send a message when someone joins')}</span>
          <input type="checkbox" checked={joinNotices} onChange={(e) => setJoinNotices(e.target.checked)} className="h-5 w-5 accent-accent" data-join-notices />
        </label>
        <label className={`flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 ${joinNotices ? 'cursor-pointer' : 'opacity-50'}`}>
          <span className="text-sm">{t('Prompt members to wave hello to newcomers')}</span>
          <input type="checkbox" checked={joinWave} disabled={!joinNotices} onChange={(e) => setJoinWave(e.target.checked)} className="h-5 w-5 accent-accent" data-join-wave />
        </label>
      </section>
      <section className="space-y-3" data-afk-settings>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">{t('Inactive channel')}</h2>
        <div className="flex gap-3 phone:flex-col">
          <div className="flex-1">
            <label className="label" htmlFor="afk-channel">{t('Inactive channel')}</label>
            <select id="afk-channel" className="input" value={afkChannel} onChange={(e) => setAfkChannel(e.target.value)} data-afk-channel>
              <option value="">{t('No inactive channel')}</option>
              {voiceChannels.map((c) => <option key={c.id} value={c.id}>🔊 {c.name}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="afk-timeout">{t('Inactive timeout')}</label>
            <select id="afk-timeout" className="input" value={afkTimeout} onChange={(e) => setAfkTimeout(Number(e.target.value))} disabled={!afkChannel} data-afk-timeout>
              {[[60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [3600, '1 hour']].map(([v, l]) => <option key={v} value={v}>{t(String(l))}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-text-2">{t('Members who haven\'t spoken in voice for longer than the timeout are moved here and muted.')}</p>
      </section>
      <section className="space-y-2" data-default-notifications>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">{t('Default notification settings')}</h2>
        <p className="text-xs text-text-2">{t('What members get notified about until they choose for themselves. Busy servers usually pick Only @mentions.')}</p>
        {([['all', 'All Messages'], ['mentions', 'Only @mentions']] as const).map(([v, label]) => (
          <label key={v} className="flex items-center gap-3 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer text-sm">
            <input type="radio" name="default-notif" checked={defaultNotif === v} onChange={() => setDefaultNotif(v)} className="h-4 w-4 accent-accent" data-default-notif={v} />{t(label)}
          </label>
        ))}
      </section>
      <div className="space-y-2" data-guild-rules>
        <label className="label" htmlFor="rules-channel">{t('Rules channel')}</label>
        <select id="rules-channel" className="input" value={rulesChannel} onChange={(e) => setRulesChannel(e.target.value)} data-rules-channel>
          <option value="">{t('None')}</option>
          {textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <p className="text-xs text-text-2">{t('Gets a rulebook icon in the channel list and is linked from the welcome screen and the rules prompt.')}</p>
        <label className="label pt-2">{t('Server rules')}</label>
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={6} maxLength={4000} placeholder={'1. Be kind.\n2. No spam.\nMarkdown works.'} className="input resize-y font-mono text-sm" data-guild-rules-text />
        <label className="flex items-center justify-between rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
          <span><span className="block font-semibold text-sm">{t('Members must accept the rules before chatting')}</span><span className="block text-xs text-text-2">{t('New and existing members see the rules with an "I agree" button; until they accept they can read but not send messages.')}</span></span>
          <input type="checkbox" checked={rulesRequired} onChange={(e) => setRulesRequired(e.target.checked)} className="h-5 w-5 accent-accent" data-guild-rules-required />
        </label>
      </div>
      {dirty && (
        <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">{t('Careful — you have unsaved changes!')}</span>
          <button type="button" className="btn-ghost" onClick={reset}>{t('Reset')}</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !name.trim()}>{t('Save Changes')}</button>
        </div>
      )}
    </form>
  )
}
