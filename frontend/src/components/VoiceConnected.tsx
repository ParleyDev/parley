import { AudioWaveform, Bug, Copy, Lock, MonitorOff, MonitorUp, Music2, PhoneOff, Signal, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { profileOf } from '../lib/audioProfile'
import { dmName } from '../lib/dm'
import { locale, useT } from '../lib/i18n'
import { voice } from '../lib/voice'
import { useStore } from '../store'
import AudioStats from './AudioStats'
import SoundboardPicker from './SoundboardPicker'

/** Ping samples for the call you're in (kept across re-renders; reset on a new call). */
const pings: { at: number; ms: number }[] = []
let pingsFor: string | null = null

/** Average round trip to the people (or media server) you're connected to, from the call's WebRTC stats. */
async function samplePing(channelId: string) {
  if (pingsFor !== channelId) { pings.length = 0; pingsFor = channelId }
  const rows = await voice.audioStats().catch(() => [])
  const rtts = rows.map((r) => r.rttMs).filter((v): v is number => v != null)
  if (!rtts.length) return
  pings.push({ at: Date.now(), ms: Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) })
  if (pings.length > 100) pings.shift()
}

/**
 * The Voice Connected panel above your user card: where you're connected (click the signal for connection details and
 * the call's privacy code), noise suppression, hang up, and camera / screen share / soundboard.
 */
export default function VoiceConnected() {
  const t = useT()
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const channel = useStore((s) => (s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] : undefined))
  const guild = useStore((s) => (channel?.guild_id ? s.guilds[channel.guild_id] : undefined))
  const dm = useStore((s) => { const d = s.myVoiceChannelId ? s.dms[s.myVoiceChannelId] : undefined; return d ? dmName(d, s.users) : undefined })
  const pttMode = useStore((s) => s.voiceSettings.inputMode === 'ptt')
  const pttHeld = useStore((s) => s.pttHeld)
  const noise = useStore((s) => s.voiceSettings.noiseSuppression)
  const updateVoiceSettings = useStore((s) => s.updateVoiceSettings)
  const localCamera = useStore((s) => s.localCamera)
  const localScreen = useStore((s) => s.localScreen)
  const [details, setDetails] = useState(false)
  const [board, setBoard] = useState(false)
  const [, tick] = useState(0)
  // Sample the ping every few seconds for the whole call, so the graph has history when you open it.
  useEffect(() => {
    if (!myVoice) return
    const go = () => { void samplePing(myVoice).then(() => tick((n) => n + 1)) }
    go(); const id = setInterval(go, 4000)
    return () => clearInterval(id)
  }, [myVoice])
  if (!myVoice) return null
  const prof = profileOf(channel)
  const where = dm ? `${dm} | Direct Message` : `${channel?.name ?? 'Voice'}${guild ? ` | ${guild.name}` : ''}`
  const last = pings[pings.length - 1]?.ms
  const quality = last == null ? 'text-success' : last < 150 ? 'text-success' : last < 250 ? 'text-warn' : 'text-danger'
  const playSound = async (id: string) => { try { await api.post(`/channels/${myVoice}/soundboard/${id}`) } catch (e) { useStore.getState().pushToast((e as Error).message, 'error') } }
  const wide = 'flex h-8 flex-1 items-center justify-center rounded-md bg-bg-3 text-text-1 hover:bg-bg-4 hover:text-text-0'
  return (
    <div className="relative mb-2 rounded-xl border border-line bg-bg-0/60 p-2" data-voice-connected>
      {details && <VoiceDetails onClose={() => setDetails(false)} e2ee={!!channel?.e2ee} />}
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setDetails((d) => !d)} title="Connection details" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-bg-3 ${connecting ? 'text-warn' : quality}`} data-audio-stats-toggle data-voice-details-toggle><Signal size={18} /></button>
        <button type="button" onClick={() => setDetails((d) => !d)} className="min-w-0 flex-1 text-left">
          <div className={`flex items-center gap-1 text-[13px] font-bold ${connecting ? 'text-warn' : quality}`}>
            <span className="truncate">{connecting ? 'Connecting…' : t('Voice Connected')}</span>
            {prof.mode === 'music' && <span title={`High-fidelity audio, ${prof.bitrate} kbps stereo`} className="rounded bg-accent/20 px-1 text-[9px] font-bold text-accent" data-hifi-badge>HI-FI</span>}
            {prof.lowLatency && <span title="Ultra-low latency: 10 ms frames, minimal jitter buffer" className="rounded bg-bg-3 px-1 text-[9px] font-bold text-text-1" data-lowlat-badge>LL</span>}
            {pttMode && <span title="Push to talk" className={`rounded px-1 text-[9px] font-bold ${pttHeld ? 'bg-success text-black' : 'bg-bg-3 text-text-2'}`}>PTT</span>}
          </div>
          <div className="truncate text-[11px] text-text-2 hover:underline" data-voice-where>{where}</div>
        </button>
        <button type="button" onClick={() => updateVoiceSettings({ noiseSuppression: !noise })} title={noise ? 'Noise suppression on' : 'Noise suppression off'} aria-pressed={noise}
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-bg-3 ${noise ? 'text-text-0' : 'text-text-2'}`} data-noise-toggle={noise ? 'on' : 'off'}>
          <AudioWaveform size={18} />{!noise && <span className="pointer-events-none absolute h-[2px] w-5 rotate-45 rounded bg-current" />}
        </button>
        <button type="button" title={t('Disconnect')} onClick={() => voice.leave()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-1 hover:bg-bg-3 hover:text-danger" data-voice-disconnect><PhoneOff size={18} /></button>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" className={`${wide} ${localCamera ? 'text-success' : ''}`} title={localCamera ? 'Turn Off Camera' : 'Turn On Camera'} onClick={() => voice.toggleCamera()} data-voice-camera>{localCamera ? <Video size={18} /> : <VideoOff size={18} />}</button>
        <button type="button" className={`${wide} ${localScreen ? 'text-success' : ''}`} title={localScreen ? 'Stop Sharing' : 'Share Your Screen'} onClick={() => voice.toggleScreen()} data-voice-screen>{localScreen ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
        <span className="relative flex flex-1">
          <button type="button" className={`${wide} ${board ? 'bg-bg-4 text-text-0' : ''}`} title="Soundboard" onClick={() => setBoard((b) => !b)} data-voice-soundboard><Music2 size={18} /></button>
          {board && <>
            <div className="fixed inset-0 z-30" onClick={() => setBoard(false)} />
            <div className="pop absolute bottom-full right-0 z-40 mb-2 w-[300px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-bg-1 p-3 shadow-2xl" data-soundboard>
              <div className="mb-2 text-sm font-bold">Soundboard</div>
              <SoundboardPicker guildId={channel?.guild_id ?? null} onPlay={playSound} />
            </div>
          </>}
        </span>
      </div>
    </div>
  )
}

/** Connection (ping over time, debug numbers) and Privacy (the call's privacy code), like Discord's. */
function VoiceDetails({ onClose, e2ee }: { onClose: () => void; e2ee: boolean }) {
  const [tab, setTab] = useState<'connection' | 'privacy'>('connection')
  const [debug, setDebug] = useState(false)
  const callE2ee = useStore((s) => s.callE2ee)
  const instance = useStore((s) => s.instance)
  const pushToast = useStore((s) => s.pushToast)
  const ref = useRef<HTMLDivElement>(null)
  const avg = pings.length ? Math.round(pings.reduce((a, p) => a + p.ms, 0) / pings.length) : null
  const last = pings[pings.length - 1]?.ms ?? null
  const server = voice.debug.mode === 'sfu' ? (() => { try { return new URL(instance.livekit_url ?? '').host || 'Media server' } catch { return 'Media server' } })() : 'Direct, peer to peer'
  const encrypted = e2ee || voice.debug.e2ee
  const code = callE2ee?.code ?? ''
  // 20 digits as four groups of five (the code arrives spaced in fours).
  const groups = code.replace(/\D/g, '').match(/.{1,5}/g) ?? []
  const copyLogs = async () => {
    const logs = { at: new Date().toISOString(), ...voice.debug, server, pings, stats: await voice.audioStats().catch(() => []), userAgent: navigator.userAgent }
    try { await navigator.clipboard.writeText(JSON.stringify(logs, null, 2)); pushToast('Call logs copied: paste them where you report the problem') } catch { pushToast('Clipboard unavailable', 'error') }
  }
  const badge = encrypted && <div className="mt-3 flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-1 text-xs text-success" data-voice-e2ee><Lock size={12} />End-to-end encrypted</div>
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div ref={ref} className="pop absolute bottom-full left-0 z-40 mb-2 w-[300px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-bg-1 p-3 text-sm shadow-2xl" data-voice-details>
        <div className="mb-3 flex gap-4 border-b border-line">
          {(['connection', 'privacy'] as const).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 pb-1.5 font-semibold capitalize ${tab === k ? 'border-accent text-accent' : 'border-transparent text-text-2 hover:text-text-0'}`} data-voice-tab={k}>{k}</button>)}
        </div>
        {tab === 'connection' ? (
          <div data-voice-connection>
            <PingGraph />
            <div className="mt-2 font-bold" data-voice-server>{server}</div>
            <div className="text-xs"><b>Average ping:</b> <span data-voice-avg>{avg == null ? '—' : `${avg} ms`}</span></div>
            <div className="text-xs"><b>Last ping:</b> <span data-voice-last>{last == null ? '—' : `${last} ms`}</span></div>
            <p className="mt-2 text-xs text-text-2">You may notice delayed audio at 250 ms or higher. If it stays that way, disconnect and join again.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold ${debug ? 'bg-bg-4' : 'bg-bg-3 hover:bg-bg-4'}`} onClick={() => setDebug((d) => !d)} data-voice-debug><Bug size={14} />Debug</button>
              <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-bg-3 py-1.5 text-xs font-semibold hover:bg-bg-4" onClick={copyLogs} data-voice-copy-logs><Copy size={14} />Copy Logs</button>
            </div>
            {debug && <div className="mt-2"><AudioStats inline /></div>}
            {badge}
          </div>
        ) : (
          <div data-voice-privacy>
            <div className="font-bold">Voice Privacy Code</div>
            {encrypted && groups.length > 0 ? <>
              <p className="mt-1 text-xs text-text-2">A new code is made when people join or leave. Compare it out loud: if everyone sees the same one, nobody is listening in between.</p>
              <div className="mt-3 grid grid-cols-2 gap-y-2 rounded-lg bg-bg-0/60 p-3 text-center font-mono text-base tracking-wider" data-voice-code>{groups.map((g, i) => <span key={i}>{g}</span>)}</div>
              <button type="button" className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-bg-3 py-1.5 text-xs font-semibold hover:bg-bg-4" onClick={() => { void navigator.clipboard?.writeText(groups.join(' ')).then(() => pushToast('Privacy code copied')) }} data-voice-copy-code><Copy size={14} />Copy</button>
              <p className="mt-2 text-xs text-text-2">Only the people on this call can hear you. Not even this server can listen in.</p>
            </> : <p className="mt-1 text-xs text-text-2" data-voice-not-e2ee>This call isn't end-to-end encrypted, so there's no privacy code. Calls in channels with end-to-end encryption turned on get one.</p>}
            {badge}
          </div>
        )}
      </div>
    </>
  )
}

/** Ping over the call so far (one line, the last few minutes), with a scale and times. */
function PingGraph() {
  const max = Math.max(100, ...pings.map((p) => p.ms))
  const top = Math.ceil(max / 50) * 50
  const pts = pings.map((p, i) => `${pings.length < 2 ? 100 : (i / (pings.length - 1)) * 100},${100 - (p.ms / top) * 100}`).join(' ')
  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="rounded-lg bg-bg-0/60 p-2" data-voice-ping-graph data-samples={pings.length}>
      <div className="flex gap-1">
        <div className="relative h-20 flex-1 border-b border-l border-line">
          {[0.5].map((f) => <div key={f} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${f * 100}%` }} />)}
          {pings.length > 0 ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-label="Ping over time">
              <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          ) : <div className="absolute inset-0 flex items-center justify-center text-xs text-text-2">Measuring…</div>}
        </div>
        <div className="flex h-20 flex-col justify-between text-[10px] tabular-nums text-text-2"><span>{top}</span><span>{top / 2}</span><span>0</span></div>
      </div>
      {pings.length > 1 && <div className="mt-0.5 flex justify-between pr-6 text-[10px] text-text-2"><span>{time(pings[0].at)}</span><span>{time(pings[pings.length - 1].at)}</span></div>}
    </div>
  )
}
