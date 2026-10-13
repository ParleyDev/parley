import { useShallow } from 'zustand/react/shallow'
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react'
import { useStore, voiceParticipants } from '../store'
import type { Channel } from '../lib/types'
import { voice } from '../lib/voice'
import Avatar from './Avatar'

export default function VoiceView({ channel }: { channel: Channel }) {
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const speaking = useStore((s) => s.speaking)
  const peerStatus = useStore((s) => s.peerStatus)
  const selfMute = useStore((s) => s.selfMute)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const inThis = myChannel === channel.id
  const count = participants.length

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-0">
      <header className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-line">
        <Volume2 size={22} className="text-text-2" /><span className="font-bold">{channel.name}</span>
        <span className="ml-auto text-xs text-text-2">{count} connected</span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {count === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="h-20 w-20 rounded-full bg-bg-3 flex items-center justify-center mb-4"><Volume2 size={36} className="text-text-1" /></div>
            <h2 className="text-2xl font-bold">{channel.name}</h2>
            <p className="text-text-2 mt-2 max-w-sm">No one is here yet. Join to start a voice call.</p>
          </div>
        ) : (
          <div className="grid gap-4 justify-center" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, ${count <= 2 ? '420px' : '260px'}))` }}>
            {participants.map((p) => {
              const u = users[p.user_id] ?? (me && me.id === p.user_id ? me : undefined)
              const isMe = me?.id === p.user_id
              const talking = !!speaking[p.user_id]
              const status = isMe ? (connecting ? 'connecting' : 'connected') : inThis ? peerStatus[p.user_id] ?? 'connecting' : null
              return (
                <div key={p.user_id} className={`relative aspect-video rounded-2xl bg-bg-2 border-2 flex flex-col items-center justify-center gap-3 transition-colors ${talking ? 'border-success' : 'border-line'}`}>
                  <div className={`rounded-full transition-shadow ${talking ? 'ring-4 ring-success/70' : ''}`}>
                    {u ? <Avatar user={u} size={96} /> : <div className="h-24 w-24 rounded-full bg-bg-4" />}
                  </div>
                  <div className="absolute left-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-bg-0/80 px-2 py-1 text-sm font-semibold">
                    <span className="truncate max-w-[160px]">{u?.display_name ?? 'Unknown'}</span>
                    {p.self_deaf ? <HeadphoneOff size={14} className="text-danger" /> : p.self_mute ? <MicOff size={14} className="text-danger" /> : null}
                  </div>
                  {status && status !== 'connected' && (
                    <span className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${status === 'failed' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{status === 'failed' ? 'No route' : 'Connecting'}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center gap-3 py-5 border-t border-line">
        {inThis ? (
          <>
            <Ctl label={selfMute ? 'Unmute' : 'Mute'} on={selfMute} onClick={() => voice.setMute(!selfMute)}>{selfMute ? <MicOff size={22} /> : <Mic size={22} />}</Ctl>
            <Ctl label={selfDeaf ? 'Undeafen' : 'Deafen'} on={selfDeaf} onClick={() => voice.setDeaf(!selfDeaf)}>{selfDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</Ctl>
            <button onClick={() => voice.leave()} title="Disconnect" className="h-14 px-6 rounded-full bg-danger text-white font-semibold flex items-center gap-2 hover:bg-danger/80"><PhoneOff size={20} /> Leave</button>
          </>
        ) : (
          <button onClick={() => voice.join(channel.id)} disabled={connecting} className="h-14 px-8 rounded-full bg-success text-black font-bold flex items-center gap-2 hover:bg-success/80 disabled:opacity-50">
            <Volume2 size={20} /> {myChannel ? 'Switch to this channel' : 'Join Voice'}
          </button>
        )}
      </div>
    </main>
  )
}

function Ctl({ children, label, on, onClick }: { children: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return <button title={label} onClick={onClick} className={`h-14 w-14 rounded-full flex items-center justify-center ${on ? 'bg-white text-black' : 'bg-bg-3 text-text-0 hover:bg-bg-4'}`}>{children}</button>
}
