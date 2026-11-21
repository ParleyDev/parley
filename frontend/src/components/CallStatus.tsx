import { Headphones, MicOff, PhoneOff, RefreshCw, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { recallCall, rememberCall } from '../lib/callRestore'
import { dmName } from '../lib/dm'
import { useT } from '../lib/i18n'
import { callFailureText, voice } from '../lib/voice'
import { useStore } from '../store'
import { usePhone } from '../lib/swipe'

/** Where a call lives, for the notices: its name and the page that shows it. */
function useCallPlace(channelId: string | null) {
  const channel = useStore((s) => (channelId ? s.channels[channelId] : undefined))
  const guild = useStore((s) => (channel?.guild_id ? s.guilds[channel.guild_id] : undefined))
  const dm = useStore((s) => { const d = channelId ? s.dms[channelId] : undefined; return d ? dmName(d, s.users) : undefined })
  if (!channelId || (!channel && !dm)) return null
  return { name: dm ?? (guild ? `${channel!.name} · ${guild.name}` : channel!.name), path: channel?.guild_id ? `/channels/${channel.guild_id}/${channelId}` : `/channels/@me/${channelId}` }
}

/** "Reconnecting…" over a call's stage while its connection is being restored. */
export function ReconnectingPill({ channelId }: { channelId: string }) {
  const t = useT()
  const on = useStore((s) => s.myVoiceChannelId === channelId && s.callStatus.phase === 'reconnecting')
  if (!on) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center" role="status" data-call-reconnecting>
      <span className="flex items-center gap-2 rounded-full bg-bg-0/90 px-3 py-1.5 text-sm font-semibold text-warn shadow-lg ring-1 ring-line"><RefreshCw size={14} className="animate-spin" />{t('Reconnecting…')}</span>
    </div>
  )
}

const card = 'pop pointer-events-auto w-full rounded-xl border border-line bg-bg-1 p-3 shadow-2xl'

/**
 * What a call needs the member to know or decide, wherever they are in the app: a call that failed (with Try again),
 * a call to rejoin after a reload, a microphone that went away, a device that was just plugged in.
 *
 * On wide screens they sit where the call always is, above the Voice Connected panel (the user panel renders this).
 * Phones show one pane at a time and that panel is often off screen, so there they float under the header (the app
 * shell renders it with `floating`).
 */
export default function CallNotices({ floating = false }: { floating?: boolean }) {
  const phone = usePhone()
  if (phone !== floating) return null
  return (
    <div className={floating ? 'pointer-events-none fixed left-1/2 top-14 z-40 flex w-[min(92vw,24rem)] -translate-x-1/2 flex-col gap-2' : 'flex flex-col gap-2 empty:hidden mb-2'} data-call-notices>
      <CallFailed />
      <CallRejoin />
      <MicLost />
      <DeviceOffer />
    </div>
  )
}

function CallFailed() {
  const t = useT()
  const status = useStore((s) => s.callStatus)
  const place = useCallPlace(status.phase === 'failed' ? status.channelId : null)
  if (status.phase !== 'failed') return null
  const mic = status.reason === 'microphone'
  return (
    <div className={card} role="alert" data-call-failed={status.reason ?? ''}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">{mic ? <MicOff size={16} /> : <PhoneOff size={16} />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{mic ? t("Couldn't join the call") : t('Call connection failed')}</div>
          {place && <div className="truncate text-xs text-text-2" data-call-failed-where>{place.name}</div>}
          <p className="mt-1 text-xs text-text-1" data-call-failed-why>{callFailureText(status.reason, status.detail)}</p>
          {status.reason === 'refused' && status.detail && <p className="mt-0.5 text-xs text-text-2" data-call-failed-detail>{status.detail}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => voice.retryCall()} className="btn-primary flex-1 py-1.5 text-sm" data-call-retry><RotateCw size={14} /> {t('Try again')}</button>
        <button type="button" onClick={() => voice.dismissCall()} className="btn-ghost flex-1 py-1.5 text-sm" data-call-dismiss>{t('Dismiss')}</button>
      </div>
      {mic && <button type="button" onClick={() => voice.retryCall(true)} className="mt-1.5 w-full text-center text-[11px] text-text-2 hover:text-text-1 hover:underline" data-call-listen-only>{t('Join without a microphone')}</button>}
    </div>
  )
}

/** After a reload or restart in the middle of a call: offer to go back, for a few minutes. Never rejoins by itself. */
function CallRejoin() {
  const t = useT()
  const navigate = useNavigate()
  const ready = useStore((s) => s.ready)
  const inCall = useStore((s) => !!s.myVoiceChannelId || s.callStatus.phase !== 'idle')
  // Already in a call from another window or device: that session is the call, nothing to restore here.
  const elsewhere = useStore((s) => !!(s.user && s.voiceStates[s.user.id]?.channel_id))
  const [last, setLast] = useState<{ channelId: string; at: number } | null>(null)
  // Read once, when the app has its data: this is about the call from before this page load.
  useEffect(() => { if (ready) setLast(recallCall()) }, [ready])
  const place = useCallPlace(last?.channelId ?? null)
  const gone = !last || inCall || elsewhere || !place
  // Joining any call, or the call no longer being there to see, settles it.
  useEffect(() => { if (last && ready && (inCall || elsewhere)) setLast(null) }, [last, ready, inCall, elsewhere])
  useEffect(() => {
    if (!last) return
    const h = setTimeout(() => { rememberCall(null); setLast(null) }, 60_000)
    return () => clearTimeout(h)
  }, [last])
  if (gone) return null
  const done = () => { rememberCall(null); setLast(null) }
  return (
    <div className={card} role="alert" data-call-rejoin={last.channelId}>
      <div className="text-sm font-bold">{t('You were in a call')}</div>
      <p className="mt-0.5 truncate text-xs text-text-1">{t('Parley reloaded while you were in {name}.', { name: place.name })}</p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => { const id = last.channelId; done(); navigate(place.path); void voice.join(id) }} className="btn-primary flex-1 bg-success py-1.5 text-sm text-black hover:bg-success/80" data-call-rejoin-yes>{t('Rejoin')}</button>
        <button type="button" onClick={done} className="btn-ghost flex-1 py-1.5 text-sm" data-call-rejoin-no>{t('Not now')}</button>
      </div>
    </div>
  )
}

function MicLost() {
  const t = useT()
  const lost = useStore((s) => s.micLost && !!s.myVoiceChannelId)
  const [busy, setBusy] = useState(false)
  if (!lost) return null
  return (
    <div className={card} role="alert" data-mic-lost>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger"><MicOff size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t('No microphone')}</div>
          <p className="mt-0.5 text-xs text-text-1">{t("Parley has no microphone to use, so nobody can hear you. Connect one and Parley will pick it up.")}</p>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void voice.recoverMic(false).finally(() => setBusy(false)) }} className="btn-primary flex-1 py-1.5 text-sm disabled:opacity-50" data-mic-retry><RotateCw size={14} /> {t('Try again')}</button>
      </div>
    </div>
  )
}

function DeviceOffer() {
  const t = useT()
  const offer = useStore((s) => s.deviceOffer)
  if (!offer) return null
  return (
    <div className={card} role="alert" data-device-offer={offer.label}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Headphones size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t('New audio device')}</div>
          <p className="mt-0.5 text-xs text-text-1">{t('Use {device} for this call?', { device: offer.label })}</p>
        </div>
        <button type="button" onClick={() => voice.declineDevice()} title={t('Not now')} aria-label={t('Not now')} className="rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0" data-device-later><X size={14} /></button>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => voice.acceptDevice()} className="btn-primary flex-1 py-1.5 text-sm" data-device-switch>{t('Switch')}</button>
        <button type="button" onClick={() => voice.declineDevice()} className="btn-ghost flex-1 py-1.5 text-sm">{t('Not now')}</button>
      </div>
      <button type="button" onClick={() => voice.declineDevice(true)} className="mt-1.5 w-full text-center text-[11px] text-text-2 hover:text-text-1 hover:underline" data-device-never>{t("Don't suggest this device again")}</button>
    </div>
  )
}
