import { Captions as CaptionsIcon } from 'lucide-react'
import { captionsAvailable, useCaptionLines } from '../lib/captions'
import { voice } from '../lib/voice'
import { useStore } from '../store'
import { ControlButton } from './CallControls'

/** CC in the call controls: live captions for yourself (not in end-to-end encrypted calls). */
export function CaptionsButton({ channelId }: { channelId: string }) {
  const on = useStore((s) => !!(s.user && s.voiceStates[s.user.id]?.captions))
  const e2ee = useStore((s) => !!(s.channels[channelId] ?? s.dms[channelId])?.e2ee)
  const stt = useStore((s) => !!s.instance.transcription)
  const ok = captionsAvailable(channelId)
  const label = on ? 'Turn Off Captions' : !stt ? 'Captions need speech-to-text on this server' : e2ee ? 'Captions are off in end-to-end encrypted calls' : 'Turn On Captions'
  return <ControlButton label={label} on={on} disabled={!on && !ok} onClick={() => voice.setCaptions(!on)} data-captions-toggle={on ? 'on' : 'off'}><CaptionsIcon size={20} /></ControlButton>
}

/** The last few caption lines, under the call's tiles. */
export function CaptionsOverlay({ guildId }: { guildId: string | null }) {
  const lines = useCaptionLines()
  const members = useStore((s) => (guildId ? s.members[guildId] : undefined))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const name = (id: string) => members?.[id]?.nickname || users[id]?.display_name || (me?.id === id ? me.display_name : 'Someone')
  if (!lines.length) return null
  return (
    <div className="shrink-0 mx-auto w-full max-w-[720px] rounded-lg bg-black/75 px-4 py-2 text-[15px] leading-6 text-white" aria-live="polite" data-captions>
      {lines.map((l) => <div key={l.key} data-caption-line={l.userId}><b className="mr-1.5 text-white/70">{name(l.userId)}:</b>{l.text}</div>)}
    </div>
  )
}
