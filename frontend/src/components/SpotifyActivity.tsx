import { Eye, Gamepad2, Headphones, Music, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useT, tn } from '../lib/i18n'
import type { Activity, ManualActivity, SpotifyActivity } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'

const SPOTIFY = '#1db954'
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Ticks once a second while a song plays, for its progress bar. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [on])
  return now
}

/** "Listening to Spotify" on a profile: the song, how far in, and Play on Spotify / Listen Along. */
export function SpotifyCard({ userId, activity: a, dark }: { userId: string; activity: SpotifyActivity; dark?: boolean }) {
  const t = useT()
  const me = useStore((s) => s.user?.id)
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  const now = useNow(true)
  const elapsed = Math.min(Math.max(now - a.started_at, 0), a.duration_ms)
  const party = a.party ?? []
  const along = !!me && party.includes(me)
  const listen = async () => {
    setBusy(true)
    try { await api.post(`/users/${userId}/listen-along`, {}); pushToast(t('Listening along on Spotify')) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const stop = async () => { setBusy(true); try { await api.delete('/users/@me/listen-along') } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: dark ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-activity="spotify" data-activity-track={a.track_id}>
      <h3 className="text-xs font-bold flex items-center gap-1.5">{t('Listening to Spotify')}<Music size={12} style={{ color: SPOTIFY }} /></h3>
      <div className="flex gap-3">
        {a.art ? <img src={a.art} alt="" className="h-16 w-16 rounded-md object-cover shrink-0" /> : <div className="h-16 w-16 rounded-md bg-black/30 flex items-center justify-center shrink-0"><Music size={24} /></div>}
        <div className="min-w-0 text-sm leading-5">
          <a href={a.url} target="_blank" rel="noreferrer" className="block font-semibold truncate hover:underline" data-activity-title>{a.title}</a>
          <div className="truncate text-[#b5bac1]" data-activity-artists>{t('by {artists}', { artists: a.artists.join(', ') })}</div>
          {a.album && <div className="truncate text-[#b5bac1]">{t('on {album}', { album: a.album })}</div>}
        </div>
      </div>
      {a.duration_ms > 0 && (
        <div className="space-y-0.5">
          <div className="h-1 rounded-full bg-white/20 overflow-hidden"><div className="h-full rounded-full bg-white" style={{ width: `${(elapsed / a.duration_ms) * 100}%` }} /></div>
          <div className="flex justify-between text-[11px] text-[#b5bac1]"><span>{clock(elapsed)}</span><span>{clock(a.duration_ms)}</span></div>
        </div>
      )}
      {party.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[#b5bac1]" data-activity-party={party.length}>
          <span className="flex -space-x-1.5">{party.slice(0, 5).map((id) => <span key={id} className="rounded-full ring-2 ring-black/40"><Avatar user={{ id, display_name: users[id]?.display_name ?? '', avatar_url: users[id]?.avatar_url ?? null }} size={16} /></span>)}</span>
          {party.length === 1 ? t('1 listening along') : t('{n} listening along', { n: party.length })}
        </div>
      )}
      <div className="flex gap-2">
        <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 rounded-md px-2 py-1.5 text-center text-sm font-medium text-white" style={{ background: SPOTIFY }} data-activity-play>{t('Play on Spotify')}</a>
        {userId !== me && (along
          ? <button type="button" disabled={busy} onClick={stop} className="flex-1 rounded-md bg-white/15 px-2 py-1.5 text-sm font-medium hover:bg-white/25 disabled:opacity-50" data-listen-along="stop">{t('Stop Listening')}</button>
          : <button type="button" disabled={busy} onClick={listen} className="flex-1 rounded-md bg-white/15 px-2 py-1.5 text-sm font-medium hover:bg-white/25 disabled:opacity-50 flex items-center justify-center gap-1.5" data-listen-along="start"><Headphones size={14} />{t('Listen Along')}</button>)}
      </div>
    </div>
  )
}

/** The verb line for any activity: "Playing **Factorio**", "Listening to **Spotify**". */
function verb(a: Activity, name: React.ReactNode) {
  const vars = { name }
  return a.type === 'playing' ? tn('Playing {name}', vars) : a.type === 'watching' ? tn('Watching {name}', vars) : a.type === 'competing' ? tn('Competing in {name}', vars) : tn('Listening to {name}', vars)
}

/** One line for lists. */
export function ActivityLine({ activity: a }: { activity: Activity }) {
  return <span className="block truncate text-xs text-text-2" data-member-activity={a.name}>{verb(a, <b className="font-semibold">{a.name}</b>)}</span>
}

/** "for 12 minutes" / "for 2 hours". */
function since(t: ReturnType<typeof useT>, from: number, now: number) {
  const m = Math.max(0, Math.floor((now - from) / 60000))
  if (m < 1) return t('just started')
  if (m < 60) return m === 1 ? t('for 1 minute') : t('for {n} minutes', { n: m })
  const h = Math.floor(m / 60)
  return h === 1 ? t('for 1 hour') : t('for {n} hours', { n: h })
}

/** A hand-set activity on a profile. */
function ManualCard({ activity: a, dark }: { activity: ManualActivity; dark?: boolean }) {
  const t = useT()
  const now = useNow(true)
  const Icon = a.type === 'watching' ? Eye : a.type === 'competing' ? Trophy : a.type === 'listening' ? Headphones : Gamepad2
  const heading = a.type === 'playing' ? t('Playing') : a.type === 'watching' ? t('Watching') : a.type === 'competing' ? t('Competing in') : t('Listening to')
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: dark ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-activity="manual" data-activity-type={a.type}>
      <h3 className="text-xs font-bold">{heading}</h3>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-md bg-black/30 flex items-center justify-center shrink-0"><Icon size={22} /></div>
        <div className="min-w-0 text-sm leading-5"><div className="font-semibold truncate" data-activity-name>{a.name}</div><div className="text-[#b5bac1]">{since(t, a.started_at, now)}</div></div>
      </div>
    </div>
  )
}

/** Whatever the person is doing, as a profile card. */
export function ActivityCard({ userId, activity, dark }: { userId: string; activity: Activity; dark?: boolean }) {
  return activity.manual ? <ManualCard activity={activity} dark={dark} /> : <SpotifyCard userId={userId} activity={activity} dark={dark} />
}
