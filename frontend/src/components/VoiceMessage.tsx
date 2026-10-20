import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '../lib/types'

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const SPEEDS = [1, 1.5, 2]

/** Snazzy voice-message player: waveform bars that fill as it plays, click-to-seek, speed toggle. */
export default function VoiceMessage({ a, mine }: { a: Attachment; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [speed, setSpeed] = useState(1)
  const bars = a.waveform ? Uint8Array.from(atob(a.waveform), (c) => c.charCodeAt(0)) : new Uint8Array(64).fill(80)
  const total = a.duration_ms ?? 0
  useEffect(() => { const el = audio.current; if (!el) return; const t = () => setPos(el.currentTime * 1000); el.addEventListener('timeupdate', t); return () => el.removeEventListener('timeupdate', t) }, [])
  const toggle = () => { const el = audio.current; if (!el) return; if (el.paused) { el.playbackRate = speed; el.play().catch(() => {}) } else el.pause() }
  const seek = (frac: number) => { const el = audio.current; if (!el || !total) return; el.currentTime = (frac * total) / 1000; setPos(frac * total) }
  const cycleSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (audio.current) audio.current.playbackRate = next }
  const progress = total ? Math.min(1, pos / total) : 0
  return (
    <div className={`mt-1 flex w-full max-w-[360px] items-center gap-3 rounded-full px-3 py-2 ${mine ? 'bg-accent text-white' : 'bg-bg-3 text-text-0'}`} data-voice-message={a.id} data-playing={playing ? '1' : '0'} data-duration={total}>
      <audio ref={audio} src={a.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0) }} />
      <button type="button" onClick={toggle} className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-accent text-white hover:bg-accent-hover'}`} title={playing ? 'Pause' : 'Play'} data-voice-play>
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex h-8 flex-1 items-center gap-[2px] cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }} role="slider" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(pos)} data-voice-wave>
        {Array.from(bars).map((v, i) => {
          const played = (i + 1) / bars.length <= progress
          return <span key={i} className={`w-[3px] shrink-0 rounded-full transition-[height] duration-150 ${mine ? (played ? 'bg-white' : 'bg-white/40') : (played ? 'bg-accent' : 'bg-text-2/50')}`} style={{ height: `${Math.max(12, (v / 255) * 100)}%` }} />
        })}
      </div>
      <span className={`shrink-0 text-xs tabular-nums ${mine ? 'text-white/85' : 'text-text-1'}`} data-voice-time>{playing || pos > 0 ? fmt(pos) : fmt(total)}</span>
      <button type="button" onClick={cycleSpeed} className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-bg-4 text-text-1 hover:text-text-0'}`} title="Playback speed" data-voice-speed>{speed}×</button>
    </div>
  )
}
