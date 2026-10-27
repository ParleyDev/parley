import { Headphones, MicOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Avatar from '../components/Avatar'
import { OVERLAY_CHANNEL, type OverlayMsg } from '../lib/overlay'
import { useT } from '../lib/i18n'
import { useStore } from '../store'

/**
 * The desktop app's in-game overlay window: who's in your call, who's talking (from the main window), and who's
 * muted, on a see-through background. The top bar drags the window when it isn't click-through.
 */
export default function OverlayPage() {
  const t = useT()
  const me = useStore((s) => s.user)
  const myChannel = useStore((s) => (s.user ? s.voiceStates[s.user.id]?.channel_id ?? null : null))
  const channel = useStore((s) => (myChannel ? s.channels[myChannel] ?? s.dms[myChannel] : undefined))
  const people = useStore(useShallow((s) => Object.values(s.voiceStates).filter((v) => v.channel_id === myChannel)))
  const users = useStore((s) => s.users)
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  useEffect(() => {
    for (const el of [document.documentElement, document.body]) el.style.background = 'transparent'
    const bc = new BroadcastChannel(OVERLAY_CHANNEL)
    bc.onmessage = (e) => { const m = e.data as OverlayMsg; if (m && typeof m === 'object' && 'speaking' in m) setSpeaking(m.speaking ?? {}) }
    bc.postMessage('hello')
    return () => bc.close()
  }, [])
  const name = channel && 'name' in channel && channel.name ? channel.name : t('Call')
  return (
    <div className="p-2 select-none text-white" data-overlay data-overlay-channel={myChannel ?? ''}>
      <div className="rounded-xl bg-black/60 backdrop-blur-sm overflow-hidden">
        <div data-tauri-drag-region className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/70 cursor-move">{myChannel ? name : t('Not in a call')}</div>
        <ul className="px-1.5 pb-1.5 space-y-0.5">
          {people.map((v) => {
            const u = users[v.user_id] ?? (me?.id === v.user_id ? me : undefined)
            const talking = !!speaking[v.user_id]
            return (
              <li key={v.user_id} className="flex items-center gap-2 rounded-lg px-1.5 py-1" data-overlay-person={v.user_id} data-speaking={talking ? '1' : '0'}>
                <span className={`rounded-full ring-2 ${talking ? 'ring-success' : 'ring-transparent'}`}><Avatar user={{ id: v.user_id, display_name: u?.display_name ?? '', avatar_url: u?.avatar_url ?? null }} size={24} /></span>
                <span className={`truncate text-sm font-semibold ${talking ? 'text-white' : 'text-white/80'}`} style={{ textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>{u?.display_name ?? ''}</span>
                <span className="ms-auto flex items-center gap-1 text-danger">{(v.self_deaf || v.deaf) && <Headphones size={14} />}{(v.self_mute || v.mute) && <MicOff size={14} />}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
