import { Phone, PhoneOff } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { api } from '../lib/api'
import { voice } from '../lib/voice'
import { useNotifPrefs } from '../lib/notifPrefs'
import { usePrefs } from '../lib/prefs'
import Avatar from './Avatar'
import { useT } from '../lib/i18n'
import { nameOf } from '../lib/dm'

const RING_MS = 45_000

/** Bottom-right banner while someone is in a DM call you have not joined. */
export default function IncomingCall() {
  const t = useT()
  const me = useStore((s) => s.user)
  const dms = useStore((s) => s.dms)
  const voiceStates = useStore((s) => s.voiceStates)
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const navigate = useNavigate()
  const ignored = useStore((s) => s.callIgnored)
  const setIgnored = useStore((s) => s.setCallIgnored)
  // Where I am from any session (another tab, the phone): answering there must silence this one too.
  const mineElsewhere = me ? voiceStates[me.id]?.channel_id ?? null : null
  // Every DM call ringing for me, one entry per call; the first is shown and the rest are counted.
  const calls = Object.values(voiceStates).filter((v, i, all) => v.guild_id === null && v.channel_id && dms[v.channel_id] && v.user_id !== me?.id && myChannel !== v.channel_id && mineElsewhere !== v.channel_id && !ignored[v.channel_id] && all.findIndex((o) => o.channel_id === v.channel_id) === i)
  const ringing = calls[0]
  const waiting = calls.length - 1
  const modalOpen = useStore((s) => !!s.modal)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const prefs = usePrefs()
  const wantRing = useNotifPrefs().sounds.incoming_ring && !(prefs.streamer && prefs.streamerMuteSounds)
  const ringFor = ringing?.channel_id ?? null
  // Ringtone: a classic two-tone ring (440 + 480 Hz, 1 s on / 2 s off) from the Web Audio API while the banner shows,
  // for at most RING_MS; the banner stays until answered or ignored.
  useEffect(() => {
    const w = window as unknown as { __parleyRing?: boolean }
    if (!ringFor || selfDeaf || !wantRing || typeof AudioContext === 'undefined') { w.__parleyRing = false; return }
    const ctx = new AudioContext()
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination)
    for (const f of [440, 480]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(gain); o.start() }
    const burst = () => { const now = ctx.currentTime; gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.12, now + 0.03); gain.gain.setValueAtTime(0.12, now + 0.97); gain.gain.linearRampToValueAtTime(0, now + 1) }
    ctx.resume().catch(() => {}); burst()
    const timer = setInterval(burst, 3000)
    const stop = () => { clearInterval(timer); w.__parleyRing = false; ctx.close().catch(() => {}) }
    const cutoff = setTimeout(stop, RING_MS)
    w.__parleyRing = true
    return () => { clearTimeout(cutoff); stop() }
  }, [ringFor, selfDeaf, wantRing])
  // Keyboard: Ctrl/Cmd+Enter answers from anywhere; Escape ignores, unless it belongs to something else just now (a
  // dialog, a field being typed in). Ignoring only silences it here; Decline also tells the caller.
  const ringId = ringing?.channel_id ?? null
  useEffect(() => {
    if (!ringId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); navigate(`/channels/@me/${ringId}`); void voice.join(ringId); return }
      if (e.key !== 'Escape' || modalOpen || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      setIgnored(ringId, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ringId, modalOpen, navigate, setIgnored])
  if (!ringing || !ringing.channel_id) return null
  const dm = dms[ringing.channel_id]
  const caller = users[ringing.user_id] ?? dm.recipients.find((r) => r.id === ringing.user_id)
  const join = () => { navigate(`/channels/@me/${dm.id}`); voice.join(dm.id) }
  return (
    <div className="pop fixed safe-corner z-40 w-72 rounded-xl bg-bg-1 border border-line shadow-2xl p-4" role="alert" data-incoming-call>
      <div className="flex items-center gap-3">
        {caller && <Avatar user={caller} size={40} />}
        <div className="min-w-0"><div className="font-bold truncate">{(caller ? nameOf(caller, notes) : '') || t('Someone')}</div><div className="text-xs text-text-2">{t('Incoming call…')}</div>{waiting > 0 && <div className="text-xs text-text-2" data-calls-waiting={waiting}>{waiting === 1 ? t('1 more call is waiting') : t('{n} more calls are waiting', { n: waiting })}</div>}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={join} className="flex-1 btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-call-join><Phone size={16} /> {t('Join')}</button>
        <button onClick={() => { setIgnored(dm.id, true); api.post(`/channels/${dm.id}/call/decline`).catch(() => {}) }} className="flex-1 btn-danger py-1.5" data-call-decline><PhoneOff size={16} /> {t('Decline')}</button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-2">
        <button type="button" onClick={() => setIgnored(dm.id, true)} className="hover:text-text-1 hover:underline" title={t('Stop it ringing here without telling the caller')} data-call-ignore>{t('Ignore')}</button>
        <span className="phone:hidden" data-call-keys>{t('{join} to join · {ignore} to ignore', { join: /Mac/.test(navigator.userAgent) ? '⌘ Enter' : 'Ctrl + Enter', ignore: 'Esc' })}</span>
      </div>
    </div>
  )
}
