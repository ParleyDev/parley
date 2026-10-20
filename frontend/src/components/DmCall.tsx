import { useShallow } from 'zustand/react/shallow'
import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useStore, voiceParticipants } from '../store'
import type { DmChannel } from '../lib/types'
import { DeviceCtl, type DeviceKind } from './DeviceMenu'
import { voice } from '../lib/voice'
import Avatar from './Avatar'

/** A 1:1 call inside a DM: participants (with camera/screen video) and the call controls. */
export default function DmCall({ channel }: { channel: DmChannel }) {
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const speaking = useStore((s) => s.speaking)
  const selfMute = useStore((s) => s.selfMute)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const localCamera = useStore((s) => s.localCamera)
  const localScreen = useStore((s) => s.localScreen)
  const remoteMedia = useStore((s) => s.remoteMedia)
  const inThis = myChannel === channel.id
  if (participants.length === 0 && !inThis) return null
  const other = channel.recipients[0]
  return (
    <section className="shrink-0 border-b border-line bg-bg-0 px-4 py-3" data-dm-call>
      <div className="flex items-center justify-center gap-4 flex-wrap min-h-[120px]">
        {participants.map((p) => {
          const isMe = me?.id === p.user_id
          const u = users[p.user_id] ?? (isMe ? me : undefined) ?? (other?.id === p.user_id ? other : undefined)
          const media = isMe ? { camera: localCamera, screen: localScreen } : remoteMedia[p.user_id]
          const stream = p.self_stream ? media?.screen ?? null : p.self_video ? media?.camera ?? null : null
          return (
            <div key={p.user_id} className={`relative rounded-xl overflow-hidden bg-bg-2 border-2 ${speaking[p.user_id] ? 'border-success' : 'border-line'} ${stream ? 'w-72 aspect-video' : 'h-28 w-40'} flex items-center justify-center`} data-call-participant={p.user_id}>
              {stream ? <Vid stream={stream} muted={isMe} /> : u ? <Avatar user={u} size={64} /> : <div className="h-16 w-16 rounded-full bg-bg-4" />}
              <span className="absolute left-2 bottom-2 rounded-md bg-bg-0/80 px-1.5 py-0.5 text-xs font-semibold flex items-center gap-1">{u?.display_name ?? 'User'}{p.self_mute && <MicOff size={12} className="text-danger" />}</span>
              {p.self_stream && <span className="absolute left-2 top-2 rounded-md bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {inThis ? (
          <>
            <Ctl label={selfMute ? 'Unmute' : 'Mute'} on={selfMute} menu="input" onClick={() => voice.setMute(!selfMute)}>{selfMute ? <MicOff size={18} /> : <Mic size={18} />}</Ctl>
            <Ctl label={selfDeaf ? 'Undeafen' : 'Deafen'} on={selfDeaf} menu="output" onClick={() => voice.setDeaf(!selfDeaf)}>{selfDeaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</Ctl>
            <Ctl label={localCamera ? 'Turn Off Camera' : 'Turn On Camera'} on={!!localCamera} accent menu="camera" onClick={() => voice.toggleCamera()}>{localCamera ? <Video size={18} /> : <VideoOff size={18} />}</Ctl>
            <Ctl label={localScreen ? 'Stop Sharing' : 'Share Your Screen'} on={!!localScreen} accent onClick={() => voice.toggleScreen()}>{localScreen ? <MonitorOff size={18} /> : <Monitor size={18} />}</Ctl>
            <button onClick={() => voice.leave()} title="Leave Call" className="h-10 px-5 rounded-full bg-danger text-white font-semibold flex items-center gap-2 hover:bg-danger/80"><PhoneOff size={18} /> Leave</button>
          </>
        ) : (
          <button onClick={() => voice.join(channel.id)} disabled={connecting} title="Join Call" className="h-10 px-6 rounded-full bg-success text-black font-bold flex items-center gap-2 hover:bg-success/80 disabled:opacity-50" data-join-call><Phone size={18} /> {myChannel ? 'Switch to this call' : 'Join Call'}</button>
        )}
      </div>
    </section>
  )
}

function Vid({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
}

function Ctl(props: { children: React.ReactNode; label: string; on: boolean; accent?: boolean; onClick: () => void; menu?: DeviceKind }) {
  return <DeviceCtl {...props} size={40} />
}
