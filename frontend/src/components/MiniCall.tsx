import { Maximize2, PictureInPicture2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/**
 * While you're in a call but looking at something else, the call's video floats in a corner (like Discord's popout):
 * a screen share you watch, else someone's camera. Click to go back; the PiP button pops it out of the window.
 */
export default function MiniCall() {
  const channelId = useStore((s) => s.myVoiceChannelId)
  const channel = useStore((s) => (s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] ?? s.dms[s.myVoiceChannelId] : undefined))
  const remote = useStore((s) => s.remoteMedia)
  const watching = useStore((s) => s.watching)
  const users = useStore((s) => s.users)
  const voiceStates = useStore((s) => s.voiceStates)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const ref = useRef<HTMLVideoElement>(null)
  const live = (id: string) => voiceStates[id]?.channel_id === channelId
  const pick = Object.entries(remote).find(([id, m]) => live(id) && m.screen && watching[id] && voiceStates[id]?.self_stream) ?? Object.entries(remote).find(([id, m]) => live(id) && m.camera && voiceStates[id]?.self_video)
  const stream = pick ? (pick[1].screen && watching[pick[0]] ? pick[1].screen : pick[1].camera) : null
  const here = !!channelId && pathname.includes(channelId)
  const show = !!channelId && !here && !!stream && closedFor !== channelId
  useEffect(() => { const el = ref.current; if (el && stream) { el.srcObject = stream; el.play().catch(() => {}) } }, [stream, show])
  if (!show || !channel) return null
  const back = () => navigate(channel.guild_id ? `/channels/${channel.guild_id}/${channel.id}` : `/channels/@me/${channel.id}`)
  const pip = async () => { try { await ref.current?.requestPictureInPicture() } catch { useStore.getState().pushToast(t('Picture-in-picture is not available here'), 'error') } }
  return (
    <div className="pop fixed bottom-24 right-4 z-40 w-72 phone:w-56 overflow-hidden rounded-xl border border-line bg-bg-0 shadow-2xl" data-mini-call={pick?.[0]}>
      <button type="button" onClick={back} className="group relative block aspect-video w-full" title={t('Back to the call')}>
        <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain bg-black" />
        <span className="absolute left-2 bottom-2 rounded-md bg-bg-0/80 px-1.5 py-0.5 text-xs font-semibold">{users[pick![0]]?.display_name ?? t('Call')} · {channel.name || t('Call')}</span>
      </button>
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        {'pictureInPictureEnabled' in document && <button type="button" onClick={pip} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Pop out (picture-in-picture)')} aria-label={t('Picture-in-picture')} data-mini-pip><PictureInPicture2 size={14} /></button>}
        <button type="button" onClick={back} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Back to the call')} aria-label={t('Back to the call')} data-mini-back><Maximize2 size={14} /></button>
        <button type="button" onClick={() => setClosedFor(channelId)} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Hide')} aria-label={t('Hide')} data-mini-close><X size={14} /></button>
      </div>
    </div>
  )
}
