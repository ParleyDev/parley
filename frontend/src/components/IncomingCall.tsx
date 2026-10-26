import { Phone, PhoneOff } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { api } from '../lib/api'
import { voice } from '../lib/voice'
import { useNotifPrefs } from '../lib/notifPrefs'
import { usePrefs } from '../lib/prefs'
import Avatar from './Avatar'

const RING_MS = 45_000

/** Bottom-right banner while someone is in a DM call you have not joined. */
export default function IncomingCall() {
  const me = useStore((s) => s.user)
  const dms = useStore((s) => s.dms)
  const voiceStates = useStore((s) => s.voiceStates)
  const users = useStore((s) => s.users)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const navigate = useNavigate()
  const ignored = useStore((s) => s.callIgnored)
  const setIgnored = useStore((s) => s.setCallIgnored)
  // Where I am from any session (another tab, the phone): answering there must silence this one too.
  const mineElsewhere = me ? voiceStates[me.id]?.channel_id ?? null : null
  const ringing = Object.values(voiceStates).find((v) => v.guild_id === null && v.channel_id && dms[v.channel_id] && v.user_id !== me?.id && myChannel !== v.channel_id && mineElsewhere !== v.channel_id && !ignored[v.channel_id])
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
    const burst = () => { const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.12, t + 0.03); gain.gain.setValueAtTime(0.12, t + 0.97); gain.gain.linearRampToValueAtTime(0, t + 1) }
    ctx.resume().catch(() => {}); burst()
    const timer = setInterval(burst, 3000)
    const stop = () => { clearInterval(timer); w.__parleyRing = false; ctx.close().catch(() => {}) }
    const cutoff = setTimeout(stop, RING_MS)
    w.__parleyRing = true
    return () => { clearTimeout(cutoff); stop() }
  }, [ringFor, selfDeaf, wantRing])
  if (!ringing || !ringing.channel_id) return null
  const dm = dms[ringing.channel_id]
  const caller = users[ringing.user_id] ?? dm.recipients.find((r) => r.id === ringing.user_id)
  const join = () => { navigate(`/channels/@me/${dm.id}`); voice.join(dm.id) }
  return (
    <div className="pop fixed safe-corner z-40 w-72 rounded-xl bg-bg-1 border border-line shadow-2xl p-4" role="alert" data-incoming-call>
      <div className="flex items-center gap-3">
        {caller && <Avatar user={caller} size={40} />}
        <div className="min-w-0"><div className="font-bold truncate">{caller?.display_name ?? 'Someone'}</div><div className="text-xs text-text-2">Incoming call…</div></div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={join} className="flex-1 btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-call-join><Phone size={16} /> Join</button>
        <button onClick={() => { setIgnored(dm.id, true); api.post(`/channels/${dm.id}/call/decline`).catch(() => {}) }} className="flex-1 btn-danger py-1.5" data-call-decline><PhoneOff size={16} /> Decline</button>
      </div>
    </div>
  )
}
