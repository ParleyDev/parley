import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { NotifSetting } from '../../lib/notify'
import { useStore } from '../../store'
import Modal from '../Modal'
import { t, useT } from '../../lib/i18n'

const mutes = (): [string, number][] => [[t('15 minutes'), 15], [t('1 hour'), 60], [t('3 hours'), 180], [t('8 hours'), 480], [t('24 hours'), 1440], [t('Until I turn it back on'), 0]]

/** Server notification settings: mute, level, suppressions, highlights, events, mobile push and channel overrides. */
export default function GuildNotificationsModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  useT()
  const guild = useStore((s) => s.guilds[guildId])
  const settings = useStore((s) => s.notifSettings)
  const channels = useStore((s) => s.channels)
  const setNotifSetting = useStore((s) => s.setNotifSetting)
  const pushToast = useStore((s) => s.pushToast)
  const cur: Partial<NotifSetting> = settings[guildId] ?? {}
  const muted = !!cur.muted_until && new Date(cur.muted_until).getTime() > Date.now()
  const [muteFor, setMuteFor] = useState(60)
  const [addChannel, setAddChannel] = useState('')
  const put = async (target: string, body: Record<string, unknown>) => { try { setNotifSetting(await api.put<NotifSetting>(`/users/@me/notification-settings/${target}`, body)) } catch (e) { pushToast((e as Error).message, 'error') } }
  const list = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && (c.kind === 'text' || c.kind === 'forum' || c.kind === 'category')).sort((a, b) => a.position - b.position), [channels, guildId])
  const overrides = list.filter((c) => settings[c.id] && (settings[c.id].level !== 'default' || settings[c.id].muted_until))
  if (!guild) return null
  const level = cur.level && cur.level !== 'default' ? cur.level : guild.default_notifications ?? 'all'
  const box = (key: 'suppress_everyone' | 'suppress_roles' | 'suppress_highlights' | 'mute_events' | 'mobile_push', label: string, on: boolean) => (
    <label className="flex items-center justify-between gap-4 py-2 text-sm cursor-pointer"><span>{label}</span><input type="checkbox" className="h-4 w-4 accent-accent" checked={on} onChange={(e) => put(guildId, { [key]: e.target.checked })} data-gn={key} /></label>
  )
  return (
    <Modal title="Notification Settings" subtitle={guild.name} onClose={onClose} width="max-w-lg">
      <div className="space-y-5" data-guild-notifications={guildId}>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-bg-1 p-3">
          <span className="flex-1 text-sm">{muted ? (cur.muted_until && new Date(cur.muted_until).getFullYear() < 2100 ? t("Muted until {date}. You won't get notifications from this server.", { date: new Date(cur.muted_until).toLocaleString() }) : t("Muted. You won't get notifications from this server.")) : t('Mute {name}', { name: guild.name })}</span>
          {muted ? <button type="button" className="btn-primary py-1" onClick={() => put(guildId, { unmute: true })} data-gn-unmute>{t('Unmute')}</button> : <>
            <select className="input w-auto py-1" value={muteFor} onChange={(e) => setMuteFor(Number(e.target.value))} data-gn-mute-for>{mutes().map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select>
            <button type="button" className="btn-ghost py-1" onClick={() => put(guildId, { mute_minutes: muteFor })} data-gn-mute>{t('Mute')}</button></>}
        </div>
        <section>
          <h3 className="label">{t('Server notifications')}</h3>
          {([['all', t('All messages')], ['mentions', t('Only @mentions')], ['nothing', t('Nothing')]] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 py-1 text-sm cursor-pointer"><input type="radio" name="gn-level" className="h-4 w-4 accent-accent" checked={level === v} onChange={() => put(guildId, { level: v })} data-gn-level={v} /> {l}</label>
          ))}
        </section>
        <section className="divide-y divide-line">
          {box('suppress_everyone', t('Suppress @everyone and @here'), !!cur.suppress_everyone)}
          {box('suppress_roles', t('Suppress all role @mentions'), !!cur.suppress_roles)}
          {box('suppress_highlights', t('Suppress highlights'), !!cur.suppress_highlights)}
          {box('mute_events', t('Mute new events'), !!cur.mute_events)}
          {box('mobile_push', t('Mobile push notifications'), cur.mobile_push ?? true)}
        </section>
        <section>
          <h3 className="label">{t('Channel overrides')}</h3>
          <div className="space-y-1.5">
            {overrides.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg bg-bg-1 px-2 py-1.5 text-sm" data-gn-override={c.id}>
                <span className="flex-1 truncate">{c.kind === 'category' ? c.name.toUpperCase() : `#${c.name}`}</span>
                <select className="input w-auto py-0.5 text-xs" value={settings[c.id].level} onChange={(e) => put(c.id, { level: e.target.value })}>{[['default', t('Default')], ['all', t('All')], ['mentions', t('Mentions')], ['nothing', t('Nothing')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <button type="button" title={t('Remove override')} className="text-text-2 hover:text-danger" onClick={() => put(c.id, { level: 'default', unmute: true })}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <select className="input flex-1 py-1 text-sm" value={addChannel} onChange={(e) => setAddChannel(e.target.value)} data-gn-add-channel><option value="">{t('Add a channel or category…')}</option>{list.filter((c) => !overrides.includes(c)).map((c) => <option key={c.id} value={c.id}>{c.kind === 'category' ? c.name.toUpperCase() : `#${c.name}`}</option>)}</select>
              <button type="button" className="btn-ghost py-1" disabled={!addChannel} onClick={() => { void put(addChannel, { level: 'mentions' }); setAddChannel('') }} data-gn-add>{t('Add')}</button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
