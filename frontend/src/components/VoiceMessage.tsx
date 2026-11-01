import { ChevronDown, Headphones, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import type { Attachment } from '../lib/types'
import { useStore } from '../store'
import { seek as seekTrack, setSpeed as setPlayerSpeed, toggle as toggleTrack, usePlaying, type Track } from '../lib/player'
import Tooltip from './Tooltip'
import { useT } from '../lib/i18n'

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const SPEEDS = [1, 1.5, 2]

/** Snazzy voice-message player: waveform bars that fill as it plays, click-to-seek, speed toggle, optional transcript,
 *  listened state. Plays through the app-wide player (lib/player), which keeps going after you leave the chat and
 *  tells the server once it has been heard (past 80%). */
export default function VoiceMessage({ a, mine, track }: { a: Attachment; mine?: boolean; track: Track }) {
  const me = useStore((s) => s.user?.id)
  const users = useStore((s) => s.users)
  const transcription = useStore((s) => s.instance.transcription)
  const pushToast = useStore((s) => s.pushToast)
  const p = usePlaying(a.id)
  const playing = !!p?.playing
  const pos = p ? p.pos * 1000 : 0
  const [speed, setSpeed] = useState(1)
  const [showText, setShowText] = useState(false)
  const t = useT()
  const bars = a.waveform ? Uint8Array.from(atob(a.waveform), (c) => c.charCodeAt(0)) : new Uint8Array(64).fill(80)
  const total = a.duration_ms ?? 0
  const listened = !!me && !!a.listened_by?.includes(me)
  const listeners = (a.listened_by ?? []).filter((u) => u !== me)
  const tr: Track = { ...track, listen: !mine && !listened }
  const toggle = () => toggleTrack(tr, { speed })
  const seek = (frac: number) => { if (total) seekTrack(tr, (frac * total) / 1000) }
  const cycleSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (p) setPlayerSpeed(next) }
  const progress = total ? Math.min(1, pos / total) : 0
  const names = listeners.map((u) => users[u]?.display_name ?? t('Someone'))
  const tip = names.length === 0 ? '' : names.length <= 3 ? t('Listened by {names}', { names: names.join(', ') }) : t('Listened by {names} and {n} others', { names: names.slice(0, 2).join(', '), n: names.length - 2 })
  const status = a.transcript_status
  const hasText = status === 'done' && !!a.transcript
  const showTranscriptRow = hasText || (status === 'pending' && transcription !== false) || status === 'failed'
  const unplayed = !mine && !listened
  return (
    <div className="mt-1 w-full max-w-[360px]" data-voice-message={a.id} data-playing={playing ? '1' : '0'} data-duration={total} data-listened={listened ? '1' : '0'} data-listeners={listeners.length} data-transcript={status ?? 'none'}>
      <div className={`flex items-center gap-3 rounded-full px-3 py-2 ${mine ? 'bg-accent text-white' : 'bg-bg-3 text-text-0'}`}>
        <button type="button" onClick={toggle} className={`relative h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-accent text-white hover:bg-accent-hover'}`} title={playing ? t('Pause') : t('Play')} data-voice-play>
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }} role="slider" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(pos)} data-voice-wave>
          {Array.from(bars).map((v, i) => {
            const played = (i + 1) / bars.length <= progress
            return <span key={i} className={`min-w-0 flex-1 basis-0 max-w-[4px] rounded-full transition-[height] duration-150 ${mine ? (played ? 'bg-white' : 'bg-white/40') : (played ? 'bg-accent' : 'bg-text-2/50')}`} style={{ height: `${Math.max(12, (v / 255) * 100)}%` }} />
          })}
        </div>
        <span className={`relative shrink-0 text-xs tabular-nums ${mine ? 'text-white/85' : 'text-text-1'}`} data-voice-time>
          {playing || pos > 0 ? fmt(pos) : fmt(total)}
          {unplayed && <Tooltip tip={t('Not listened to yet')} className="absolute -right-2 -top-1"><span className="block h-2 w-2 rounded-full bg-accent ring-2 ring-bg-3" data-voice-unplayed /></Tooltip>}
        </span>
        {mine && listeners.length > 0 && (
          <Tooltip tip={tip}><span className="flex items-center gap-0.5 text-[11px] text-white/85" data-voice-listeners><Headphones size={13} />{listeners.length}</span></Tooltip>
        )}
        <button type="button" onClick={cycleSpeed} className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-bg-4 text-text-1 hover:text-text-0'}`} title={t('Playback speed')} data-voice-speed>{speed}×</button>
      </div>
      {showTranscriptRow && (
        <div className="mt-1 pl-3">
          {hasText ? (
            <>
              <button type="button" onClick={() => setShowText((v) => !v)} className="flex items-center gap-1 text-xs text-text-2 hover:text-text-0" data-voice-transcript-toggle aria-expanded={showText}>
                <ChevronDown size={14} className={`transition-transform ${showText ? 'rotate-180' : ''}`} />{showText ? t('Hide transcript') : t('View transcript')}
              </button>
              {showText && <div className="mt-1 max-w-[520px] rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm text-text-1 whitespace-pre-wrap" data-voice-transcript>{a.transcript}</div>}
            </>
          ) : status === 'pending' ? (
            <span className="flex items-center gap-1.5 text-xs text-text-2" data-voice-transcribing><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-2" />{t('Transcribing…')}</span>
          ) : (
            <span className="text-xs text-text-2/70" data-voice-transcript-failed>{t('Transcript unavailable')}{transcription !== false && <> · <button type="button" className="text-sky-400 hover:underline" onClick={() => api.post(`/attachments/${a.id}/transcribe`, {}).catch((e: Error) => pushToast(e.message, 'error'))} data-voice-transcript-retry>{t('Retry')}</button></>}</span>
          )}
        </div>
      )}
    </div>
  )
}
