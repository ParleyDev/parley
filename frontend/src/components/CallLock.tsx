import { Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/**
 * The lock on an end-to-end encrypted call. While you're in it, clicking shows the safety code: everyone in the call
 * sees the same digits unless someone (even the server) is intercepting, so people can compare them out loud.
 */
export default function CallLock({ channelId, compact }: { channelId: string; compact?: boolean }) {
  const on = useStore((s) => !!(s.channels[channelId] ?? s.dms[channelId])?.e2ee)
  const inThis = useStore((s) => s.myVoiceChannelId === channelId && !s.voiceConnecting)
  const e2ee = useStore((s) => s.callE2ee)
  const voiceStates = useStore((s) => s.voiceStates)
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user?.id)
  const [open, setOpen] = useState(false)
  const t = useT()
  if (!on) return null
  const others = Object.values(voiceStates).filter((v) => v.channel_id === channelId && v.user_id !== me).map((v) => v.user_id)
  const waiting = inThis && e2ee ? others.filter((id) => !e2ee.keyed.includes(id)) : []
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-success hover:bg-success/10 ${compact ? '' : 'whitespace-nowrap'}`}
        title={t('End-to-end encrypted: only the people in the call can see and hear it')} aria-expanded={open} data-call-lock>
        <Lock size={13} />{compact ? null : <span className="phone:hidden">{t('End-to-end encrypted')}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="pop absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-bg-0 p-3 text-sm shadow-2xl" data-call-lock-panel>
            <div className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-success" /> {t('End-to-end encrypted')}</div>
            <p className="mt-1 text-xs text-text-2">{t('Audio, video and screen shares are encrypted on each device with keys the server never sees.')}</p>
            {inThis && e2ee ? (
              <>
                <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Safety code')}</div>
                <div className="mt-1 whitespace-nowrap font-mono text-[15px] tracking-wide text-text-0" data-safety-code>{e2ee.code}</div>
                <p className="mt-1 text-xs text-text-2">{t('Everyone in the call should see the same code. If yours differs from someone else\'s, the call may be intercepted. It changes when people join or leave.')}</p>
                {waiting.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-warn" data-call-lock-waiting><LockOpen size={12} /> {t('Exchanging keys with {names}…', { names: waiting.map((id) => users[id]?.display_name ?? t('someone')).join(', ') })}</p>}
              </>
            ) : <p className="mt-2 text-xs text-text-2">{t('Join the call to see its safety code.')}</p>}
          </div>
        </>
      )}
    </span>
  )
}
