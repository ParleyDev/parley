import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import { myChannelPerms, useStore } from '../../store'
import Modal from '../Modal'
import { useT } from '../../lib/i18n'

/** Follow an announcement channel into a text channel of one of your servers (where you have Manage Channels). */
export default function FollowChannelModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const source = useStore((s) => s.channels[channelId])
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const pushToast = useStore((s) => s.pushToast)
  const t = useT()
  const options = useMemo(() => {
    const st = useStore.getState()
    return Object.values(channels).filter((c) => c.guild_id && c.kind === 'text' && c.id !== channelId && has(myChannelPerms(st, c.id), P.MANAGE_CHANNELS))
  }, [channels, channelId])
  const servers = [...new Set(options.map((c) => c.guild_id!))].map((id) => guilds[id]).filter(Boolean)
  const [guildId, setGuildId] = useState(servers[0]?.id ?? '')
  const inGuild = options.filter((c) => c.guild_id === guildId).sort((a, b) => a.position - b.position)
  const [target, setTarget] = useState('')
  const pick = target && inGuild.some((c) => c.id === target) ? target : inGuild[0]?.id ?? ''
  const [busy, setBusy] = useState(false)
  if (!source) return null
  const follow = async () => {
    setBusy(true)
    try { await api.post(`/channels/${channelId}/followers`, { channel_id: pick }); pushToast(t('Following #{source} in #{target}', { source: source.name, target: channels[pick]?.name ?? '' })); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={t('Follow #{name}', { name: source.name })} onClose={onClose} width="max-w-sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={busy || !pick} onClick={follow} data-follow-confirm>{t('Follow')}</button></>}>
      <div className="space-y-3" data-follow-modal>
        <p className="text-sm text-text-2">{t('Posts this channel publishes will show up in the channel you pick.')}</p>
        {servers.length === 0 ? <p className="text-sm text-text-1">{t('You need Manage Channels in a server to follow channels into it.')}</p> : (
          <>
            <div><label className="label" htmlFor="follow-guild">{t('Server')}</label>
              <select id="follow-guild" className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); setTarget('') }} data-follow-guild>{servers.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
            <div><label className="label" htmlFor="follow-channel">{t('Channel')}</label>
              <select id="follow-channel" className="input" value={pick} onChange={(e) => setTarget(e.target.value)} data-follow-target>{inGuild.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></div>
          </>
        )}
      </div>
    </Modal>
  )
}
