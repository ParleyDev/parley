import { useEffect, useState } from 'react'
import { voice } from '../lib/voice'
import { useStore } from '../store'
import type { AudioStat } from '../lib/audioProfile'

const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${v}${unit}`)

/** Live audio numbers for the current call (refreshes every second): what the profile actually achieves. */
export default function AudioStats({ onClose }: { onClose: () => void }) {
  const users = useStore((s) => s.users)
  const [rows, setRows] = useState<AudioStat[] | null>(null)
  const p = voice.audioProfile
  useEffect(() => {
    let alive = true
    const tick = async () => { const r = await voice.audioStats(); if (alive) setRows(r) }
    tick()
    const id = setInterval(tick, 1000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="pop absolute bottom-full left-0 right-0 mb-2 z-40 rounded-xl bg-bg-0 border border-line shadow-2xl p-3 text-xs" data-audio-stats>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold uppercase tracking-wider text-text-2">Audio</span>
          <span className="text-text-1" data-audio-stats-profile>{p.mode === 'music' ? 'High fidelity' : 'Voice'} · {p.bitrate} kbps{p.lowLatency ? ' · low latency' : ''}</span>
        </div>
        {rows === null && <div className="text-text-2">Measuring…</div>}
        {rows?.length === 0 && <div className="text-text-2">Nobody else is connected yet.</div>}
        <div className="space-y-2">
          {rows?.map((r) => (
            <div key={r.userId} className="rounded-lg bg-bg-1 px-2 py-1.5" data-audio-stat={r.userId}>
              <div className="flex items-center justify-between font-semibold"><span className="truncate">{users[r.userId]?.display_name ?? 'Participant'}</span><span className="text-text-2 font-normal" data-audio-stat-codec>{r.codec}</span></div>
              <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 tabular-nums text-text-1">
                <span title="Received audio bitrate">in {fmt(r.inKbps == null ? null : Math.round(r.inKbps), ' kbps')}</span>
                <span title="Sent audio bitrate">out {fmt(r.outKbps == null ? null : Math.round(r.outKbps), ' kbps')}</span>
                <span title="Size of each audio frame you send" data-audio-stat-frame>frame {fmt(r.frameMs, ' ms')}</span>
                <span title="Delay added by the receive buffer that smooths network jitter" data-audio-stat-jitter>buffer {fmt(r.jitterBufferMs, ' ms')}</span>
                <span title="Network round trip">rtt {fmt(r.rttMs, ' ms')}</span>
                <span title="Packets lost">loss {fmt(r.lossPct, '%')}</span>
              </div>
              {(r.videoIn || r.videoOut) && (
                <div className="mt-1 grid grid-cols-2 gap-x-2 tabular-nums text-text-1" data-video-stat>
                  {r.videoIn && <span title="Video you receive" data-video-in>video in {r.videoIn.width}×{r.videoIn.height}{r.videoIn.fps != null ? ` @${r.videoIn.fps}` : ''} · {fmt(r.videoIn.kbps, ' kbps')}</span>}
                  {r.videoOut && <span title="Video you send" data-video-out>video out {r.videoOut.width}×{r.videoOut.height}{r.videoOut.fps != null ? ` @${r.videoOut.fps}` : ''} · {fmt(r.videoOut.kbps, ' kbps')}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
