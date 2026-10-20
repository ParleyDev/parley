import { ChevronDown, Headphones, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Attachment } from '../lib/types'
import { useStore } from '../store'
import Tooltip from './Tooltip'

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const SPEEDS = [1, 1.5, 2]
/** Playing past this much of the clip counts as having listened. */
const LISTENED_AT = 0.8

/** Snazzy voice-message player: waveform bars that fill as it plays, click-to-seek, speed toggle, optional transcript, listened state. */
export default function VoiceMessage({ a, mine }: { a: Attachment; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const me = useStore((s) => s.user?.id)
  const users = useStore((s) => s.users)
  const transcription = useStore((s) => s.instance.transcription)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [showText, setShowText] = useState(false)
  const reported = useRef(false)
  const bars = a.waveform ? Uint8Array.from(atob(a.waveform), (c) => c.charCodeAt(0)) : new Uint8Array(64).fill(80)
  const total = a.duration_ms ?? 0
  const listened = !!me && !!a.listened_by?.includes(me)
  const listeners = (a.listened_by ?? []).filter((u) => u !== me)
  useEffect(() => { const el = audio.current; if (!el) return; const t = () => setPos(el.currentTime * 1000); el.addEventListener('timeupdate', t); return () => el.removeEventListener('timeupdate', t) }, [])
  // Past 80% (or to the end) once: tell the server so the sender sees it was heard. Own messages never count.
  useEffect(() => {
    if (mine || listened || reported.current || !total) return
    if (pos / total < LISTENED_AT) return
    reported.current = true
    api.post(`/attachments/${a.id}/listened`).catch(() => { reported.current = false })
  }, [pos, total, mine, listened, a.id])
  const toggle = () => { const el = audio.current; if (!el) return; if (el.paused) { el.playbackRate = speed; el.play().catch(() => {}) } else el.pause() }
  const seek = (frac: number) => { const el = audio.current; if (!el || !total) return; el.currentTime = (frac * total) / 1000; setPos(frac * total) }
  const cycleSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (audio.current) audio.current.playbackRate = next }
  const progress = total ? Math.min(1, pos / total) : 0
  const names = listeners.map((u) => users[u]?.display_name ?? 'Someone')
  const tip = names.length === 0 ? '' : names.length <= 3 ? `Listened by ${names.join(', ')}` : `Listened by ${names.slice(0, 2).join(', ')} and ${names.length - 2} others`
  const status = a.transcript_status
  const hasText = status === 'done' && !!a.transcript
  const showTranscriptRow = hasText || (status === 'pending' && transcription !== false) || status === 'failed'
  const unplayed = !mine && !listened
  return (
    <div className="mt-1 w-full max-w-[360px]" data-voice-message={a.id} data-playing={playing ? '1' : '0'} data-duration={total} data-listened={listened ? '1' : '0'} data-listeners={listeners.length} data-transcript={status ?? 'none'}>
      <div className={`flex items-center gap-3 rounded-full px-3 py-2 ${mine ? 'bg-accent text-white' : 'bg-bg-3 text-text-0'}`}>
        <audio ref={audio} src={a.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(total); setTimeout(() => setPos(0), 400) }} />
        <button type="button" onClick={toggle} className={`relative h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-accent text-white hover:bg-accent-hover'}`} title={playing ? 'Pause' : 'Play'} data-voice-play>
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
          {unplayed && <Tooltip tip="Not listened to yet" className="absolute -right-2 -top-1"><span className="block h-2 w-2 rounded-full bg-accent ring-2 ring-bg-3" data-voice-unplayed /></Tooltip>}
        </span>
        {mine && listeners.length > 0 && (
          <Tooltip tip={tip}><span className="flex items-center gap-0.5 text-[11px] text-white/85" data-voice-listeners><Headphones size={13} />{listeners.length}</span></Tooltip>
        )}
        <button type="button" onClick={cycleSpeed} className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-bg-4 text-text-1 hover:text-text-0'}`} title="Playback speed" data-voice-speed>{speed}×</button>
      </div>
      {showTranscriptRow && (
        <div className="mt-1 pl-3">
          {hasText ? (
            <>
              <button type="button" onClick={() => setShowText((v) => !v)} className="flex items-center gap-1 text-xs text-text-2 hover:text-text-0" data-voice-transcript-toggle aria-expanded={showText}>
                <ChevronDown size={14} className={`transition-transform ${showText ? 'rotate-180' : ''}`} />{showText ? 'Hide transcript' : 'View transcript'}
              </button>
              {showText && <div className="mt-1 max-w-[520px] rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm text-text-1 whitespace-pre-wrap" data-voice-transcript>{a.transcript}</div>}
            </>
          ) : status === 'pending' ? (
            <span className="flex items-center gap-1.5 text-xs text-text-2" data-voice-transcribing><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-2" />Transcribing…</span>
          ) : (
            <span className="text-xs text-text-2/70" data-voice-transcript-failed>Transcript unavailable</span>
          )}
        </div>
      )}
    </div>
  )
}
