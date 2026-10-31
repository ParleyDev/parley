import { Download, Play, Square, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { StudioSession } from '../lib/types'
import { useMultitrack } from '../lib/multitrack'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

const fmt = (ms: number | null | undefined) => { const s = Math.max(0, Math.round((ms ?? 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Sessions recorded in this studio, each with its per-artist tracks and a multitrack player/mixer. */
export default function StudioPanel({ channelId, canManage, onClose, width, handle }: { channelId: string; canManage: boolean; onClose: () => void; width?: number; handle?: React.ReactNode }) {
  const sessions = useStore((s) => s.studio[channelId])
  const loadStudio = useStore((s) => s.loadStudio)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState<string | null>(null)
  const t = useT()
  useEffect(() => { loadStudio(channelId) }, [channelId, loadStudio])
  const del = (s: StudioSession) => openModal({ kind: 'confirm', title: t('Delete {name}', { name: s.name }), body: s.tracks.length === 1 ? t('Removes the session and its {n} track. This cannot be undone.', { n: s.tracks.length }) : t('Removes the session and its {n} tracks. This cannot be undone.', { n: s.tracks.length }), danger: true, confirmLabel: t('Delete'),
    action: async () => { try { await api.delete(`/channels/${channelId}/studio/sessions/${s.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <section className="relative flex flex-col bg-bg-2 border-l border-line shrink-0 phone:absolute phone:inset-0 phone:w-auto phone:border-l-0 phone:z-10" data-layer="md" style={{ width: width ?? 420 }} data-studio-panel>
      {handle}
      <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line"><span className="font-bold">{t('Sessions')}</span><span className="text-xs text-text-2">{sessions ? sessions.length : '…'}</span><button onClick={onClose} title={t('Close')} className="ml-auto h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={18} /></button></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sessions?.length === 0 && <p className="text-sm text-text-2 p-4 text-center">{t('Nothing recorded yet. The engineer presses Record to start a session.')}</p>}
        {sessions?.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-bg-1" data-studio-session={s.id} data-session-live={s.ended_at ? '0' : '1'}>
            <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-left px-3 py-2 flex items-center gap-2">
              {!s.ended_at && <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />}
              <span className="font-semibold truncate flex-1">{s.name}</span>
              <span className="text-xs text-text-2">{s.tracks.length === 1 ? t('{n} track', { n: s.tracks.length }) : t('{n} tracks', { n: s.tracks.length })} · {new Date(s.started_at).toLocaleString()}</span>
            </button>
            {open === s.id && (
              <div className="border-t border-line p-3 space-y-2">
                {s.tracks.map((trk) => (
                  <div key={trk.id} className="flex items-center gap-2 text-sm" data-studio-track={trk.id} data-track-done={trk.done ? '1' : '0'}>
                    <span className="truncate flex-1">{trk.display_name}</span>
                    <span className="text-xs text-text-2 tabular-nums">{trk.done ? fmt(trk.duration_ms) : t('recording…')} · {Math.round(trk.size / 1024)} KB{trk.offset_ms ? ` · +${trk.offset_ms} ms` : ''}</span>
                    <a href={trk.url} download={`${s.name} - ${trk.display_name}.webm`} title={t('Download track')} className="text-text-2 hover:text-text-0" data-track-download><Download size={14} /></a>
                  </div>
                ))}
                {s.ended_at && s.tracks.some((trk) => trk.done) && <Mixer session={s} />}
                {canManage && <div className="flex justify-end"><button type="button" onClick={() => del(s)} className="btn-ghost py-1 text-xs text-danger" data-session-delete><Trash2 size={14} /> {t('Delete session')}</button></div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Multitrack player: plays every finished track aligned by offset with per-track gain / mute / solo, and renders a
 *  WAV mixdown offline for download. */
function Mixer({ session }: { session: StudioSession }) {
  const pushToast = useStore((s) => s.pushToast)
  const t = useT()
  const mt = useMultitrack(session)
  useEffect(() => { if (mt.error) pushToast(t('Could not load tracks: {error}', { error: mt.error }), 'error') }, [mt.error])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!mt.tracks) return <button type="button" onClick={mt.load} disabled={mt.loading} className="btn-ghost w-full justify-center text-sm" data-mix-load>{mt.loading ? t('Decoding…') : t('Open in multitrack player')}</button>
  return (
    <div className="rounded-lg bg-bg-0/50 p-2 space-y-2" data-mixer>
      <div className="flex items-center gap-2">
        <button type="button" onClick={mt.playing ? mt.stop : () => mt.play(0)} className="h-8 w-8 rounded-full bg-accent text-white flex items-center justify-center" title={mt.playing ? t('Stop') : t('Play all')} data-mix-play>{mt.playing ? <Square size={14} /> : <Play size={14} />}</button>
        <div className="flex-1 h-1.5 rounded bg-bg-4 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${mt.length ? Math.min(100, (mt.pos / mt.length) * 100) : 0}%` }} /></div>
        <span className="text-xs tabular-nums text-text-2">{fmt(mt.pos * 1000)} / {fmt(mt.length * 1000)}</span>
        <button type="button" onClick={mt.exportWav} className="btn-ghost py-1 text-xs" title={t('Render all audible tracks to one WAV')} data-mix-export><Download size={14} /> {t('Export mix')}</button>
      </div>
      {mt.tracks.map((trk, i) => (
        <div key={trk.track.id} className="flex items-center gap-2 text-xs" data-mix-track={trk.track.id}>
          <span className="w-24 truncate" title={trk.track.display_name}>{trk.track.display_name}</span>
          <button type="button" onClick={() => mt.update(i, { mute: !trk.mute })} className={`rounded px-1.5 py-0.5 font-bold ${trk.mute ? 'bg-danger text-white' : 'bg-bg-3 text-text-2'}`} data-mix-mute aria-pressed={trk.mute}>M</button>
          <button type="button" onClick={() => mt.update(i, { solo: !trk.solo })} className={`rounded px-1.5 py-0.5 font-bold ${trk.solo ? 'bg-warn text-black' : 'bg-bg-3 text-text-2'}`} data-mix-solo aria-pressed={trk.solo}>S</button>
          <input type="range" min={0} max={150} value={Math.round(trk.gain * 100)} onChange={(e) => mt.update(i, { gain: Number(e.target.value) / 100 })} className="flex-1 accent-accent" title={`${Math.round(trk.gain * 100)}%`} data-mix-gain />
          <span className="w-10 text-right tabular-nums text-text-2">{Math.round(trk.gain * 100)}%</span>
        </div>
      ))}
    </div>
  )
}
