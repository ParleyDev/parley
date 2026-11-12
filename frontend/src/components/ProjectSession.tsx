import { CalendarClock, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { endGathering, projectRights, startGathering, useGatherings } from '../lib/projects'
import type { Channel } from '../lib/types'
import { useStore } from '../store'

const elapsed = (since: string, now: number) => { const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}` }

/**
 * A project's live session in its header, like a Stage: the running one with its title and how long it has run (its
 * engineers end it), or for them a way to start one with a title.
 */
export default function ProjectSession({ channel }: { channel: Channel }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const list = useGatherings(channel.id)
  const live = list?.find((g) => !g.ended_at)
  const rights = projectRights(channel)
  const [naming, setNaming] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!live) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [live])
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  if (live) return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-success/20 py-0.5 pl-2 pr-1 text-[11px] font-bold text-success" data-project-session={live.id}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />
      <span className="truncate uppercase">{t('Live · {title}', { title: live.title })}</span>
      <span className="font-mono tabular-nums">{elapsed(live.started_at, now)}</span>
      {(rights.manage || live.started_by === useStore.getState().user?.id) && <button type="button" onClick={() => endGathering(channel.id, live.id).catch(fail)} title={t('End the session')} className="ml-0.5 flex h-5 items-center gap-1 rounded-full bg-bg-0/60 px-1.5 text-text-1 hover:text-danger" data-project-session-end><Square size={9} /> {t('End')}</button>}
    </span>
  )
  if (!rights.manage) return null
  if (naming !== null) return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); startGathering(channel.id, naming).then(() => setNaming(null)).catch(fail) }}>
      <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }} maxLength={100} placeholder={t('What are you working on?')} className="input h-7 w-52 text-xs" data-project-session-title />
      <button type="submit" className="btn-primary h-7 py-0 text-xs" data-project-session-go>{t('Start')}</button>
    </form>
  )
  return <button type="button" onClick={() => setNaming('')} className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-bg-3 px-2.5 text-[11px] font-semibold text-text-1 hover:text-text-0" title={t('Start a session: a live gathering with a beginning and an end, kept in the project\'s history')} data-project-session-start><CalendarClock size={13} /> {t('Start session')}</button>
}
