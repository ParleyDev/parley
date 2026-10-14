import { Phone, PhoneOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { voice } from '../lib/voice'
import Avatar from './Avatar'

/** Bottom-right banner while someone is in a DM call you have not joined. */
export default function IncomingCall() {
  const me = useStore((s) => s.user)
  const dms = useStore((s) => s.dms)
  const voiceStates = useStore((s) => s.voiceStates)
  const users = useStore((s) => s.users)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const navigate = useNavigate()
  const [ignored, setIgnored] = useState<Record<string, true>>({})
  const ringing = Object.values(voiceStates).find((v) => v.guild_id === null && v.channel_id && dms[v.channel_id] && v.user_id !== me?.id && myChannel !== v.channel_id && !ignored[v.channel_id])
  if (!ringing || !ringing.channel_id) return null
  const dm = dms[ringing.channel_id]
  const caller = users[ringing.user_id] ?? dm.recipients.find((r) => r.id === ringing.user_id)
  const join = () => { navigate(`/channels/@me/${dm.id}`); voice.join(dm.id) }
  return (
    <div className="pop fixed bottom-4 right-4 z-40 w-72 rounded-xl bg-bg-1 border border-line shadow-2xl p-4" role="alert" data-incoming-call>
      <div className="flex items-center gap-3">
        {caller && <Avatar user={caller} size={40} />}
        <div className="min-w-0"><div className="font-bold truncate">{caller?.display_name ?? 'Someone'}</div><div className="text-xs text-text-2">Incoming call…</div></div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={join} className="flex-1 btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-call-join><Phone size={16} /> Join</button>
        <button onClick={() => setIgnored((i) => ({ ...i, [dm.id]: true }))} className="flex-1 btn-danger py-1.5"><PhoneOff size={16} /> Ignore</button>
      </div>
    </div>
  )
}
