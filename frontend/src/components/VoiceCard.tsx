import { Volume2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useNavigate } from 'react-router-dom'
import { voice } from '../lib/voice'
import { useT } from '../lib/i18n'
import { has, P } from '../lib/perms'
import { myChannelPerms, useStore } from '../store'
import Avatar from './Avatar'

/**
 * "In voice" on a profile (Discord's card): the server voice channel they're in, who else is there, and Join Voice.
 * Only for channels you can see; nothing for DM calls or when they're not in voice.
 */
export default function VoiceCard({ userId, onJoin, dark }: { userId: string; onJoin?: () => void; dark?: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const vs = useStore((s) => s.voiceStates[userId])
  const channel = useStore((s) => (vs?.channel_id ? s.channels[vs.channel_id] : undefined))
  const guild = useStore((s) => (vs?.guild_id ? s.guilds[vs.guild_id] : undefined))
  const canSee = useStore((s) => (vs?.channel_id ? has(myChannelPerms(s, vs.channel_id), P.VIEW_CHANNEL) : false))
  const canJoin = useStore((s) => (vs?.channel_id ? has(myChannelPerms(s, vs.channel_id), P.CONNECT) : false))
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const here = useStore(useShallow((s) => (vs?.channel_id ? Object.values(s.voiceStates).filter((v) => v.channel_id === vs.channel_id).map((v) => v.user_id) : [])))
  const users = useStore((s) => s.users)
  if (!vs?.channel_id || !vs.guild_id || !channel || !guild || !canSee) return null
  const inIt = myChannel === channel.id
  const join = () => { onJoin?.(); navigate(`/channels/${guild.id}/${channel.id}`); if (!inIt) void voice.join(channel.id) }
  const faces = here.slice(0, 4)
  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: dark ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-voice-card={channel.id}>
      <div className="text-xs font-bold">{t('In voice')}</div>
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 rounded-xl bg-black/30 flex items-center justify-center">
          {faces.map((id, i) => (
            <span key={id} className="absolute rounded-full ring-2 ring-[#232428]" style={{ left: 4 + (i % 2) * 22, top: 4 + Math.floor(i / 2) * 22 }}>
              <Avatar user={users[id] ?? { id, display_name: '?', avatar_url: null }} size={24} />
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm font-semibold truncate"><Volume2 size={14} className="shrink-0" />{channel.name}</div>
          <div className="text-xs text-[#b5bac1] truncate">{t('in {server}', { server: guild.name })}{here.length > 1 ? ` · ${here.length === 2 ? t('with 1 other') : t('with {n} others', { n: here.length - 1 })}` : ''}</div>
        </div>
      </div>
      {canJoin && <button type="button" onClick={join} className="w-full h-9 rounded-md bg-white/10 hover:bg-white/15 text-sm font-semibold" data-voice-card-join>{inIt ? t('Go to Voice') : t('Join Voice')}</button>}
    </div>
  )
}
