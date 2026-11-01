import { Pause, Play, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { pause, play, seekTo, stop, usePlayer } from '../lib/player'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { jumpToMessageAsync } from './ChatView'
import AudioVisualizer from './AudioVisualizer'
import { fmtTime, Scrubber } from './AudioPlayer'

/**
 * What the app-wide player is playing, above the user panel: it keeps playing when you leave the chat it came from.
 * A mini visualiser, the title (click to go back to the message), play/pause, a seek bar and ✕ to stop.
 */
export default function NowPlaying() {
  const t = useT()
  const p = usePlayer()
  const navigate = useNavigate()
  const pushToast = useStore((s) => s.pushToast)
  if (!p.track) return null
  const tr = p.track
  const back = () => {
    if (!tr.where) return
    navigate(`/channels/${tr.where.guildId ?? '@me'}/${tr.where.channelId}`)
    useStore.getState().setMobilePane('content')
    void jumpToMessageAsync(tr.where.channelId, tr.where.messageId).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') })
  }
  const btn = 'h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-text-1 hover:bg-white/10 hover:text-text-0'
  return (
    <div className="mb-2 rounded-lg border border-line bg-bg-2 px-2 pt-1.5 pb-1 shadow-lg" data-now-playing={tr.id} data-playing={p.playing ? '1' : '0'}>
      <div className="flex items-center gap-2">
        <div className="w-9 shrink-0"><AudioVisualizer mode="bars" active playing={p.playing} className="h-7" /></div>
        <button type="button" onClick={back} disabled={!tr.where} className="min-w-0 flex-1 text-left" title={tr.where ? t('Go to message') : undefined} data-now-playing-title>
          <div className="truncate text-[13px] font-semibold text-text-0">{tr.title}</div>
          <div className="truncate text-[11px] text-text-2 tabular-nums">{fmtTime(p.pos)} / {p.duration ? fmtTime(p.duration) : '–:––'}{tr.artist ? ` · ${tr.artist}` : ''}</div>
        </button>
        <button type="button" onClick={() => (p.playing ? pause() : void play(tr))} className={btn} title={p.playing ? t('Pause') : t('Play')} aria-label={p.playing ? t('Pause') : t('Play')} data-now-playing-toggle>
          {p.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <button type="button" onClick={stop} className={btn} title={t('Stop')} aria-label={t('Stop')} data-now-playing-stop><X size={17} /></button>
      </div>
      <Scrubber pos={p.pos} duration={p.duration} onSeek={seekTo} className="mt-0.5" />
    </div>
  )
}
