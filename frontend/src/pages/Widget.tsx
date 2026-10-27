import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { APP_NAME } from '../lib/brand'
import { colorFor, initials } from '../lib/format'
import { useT } from '../lib/i18n'

interface WidgetData { id: string; name: string; icon_url: string | null; presence_count: number; instant_invite: string | null; members: { id: string; username: string; avatar_url: string | null; status: string }[] }
const DOT: Record<string, string> = { online: 'bg-success', idle: 'bg-warn', dnd: 'bg-danger' }

/** The embeddable server widget (/widget/:guildId): who's online and a Join button. Needs no login. */
export default function WidgetPage() {
  const t = useT()
  const { guildId = '' } = useParams()
  const [w, setW] = useState<WidgetData | null | 'off'>(null)
  useEffect(() => { fetch(`/api/guilds/${guildId}/widget.json`).then(async (r) => setW(r.ok ? await r.json() : 'off')).catch(() => setW('off')) }, [guildId])
  return (
    <div className="h-full w-full overflow-hidden bg-bg-1 text-text-0 flex flex-col" data-widget-page>
      {w === 'off' ? <p className="m-auto p-6 text-center text-sm text-text-2">{t("This server's widget is turned off.")}</p> : !w ? <p className="m-auto text-sm text-text-2">{t('Loading…')}</p> : (
        <>
          <div className="flex items-center gap-3 bg-accent px-4 py-3 text-white">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl flex items-center justify-center font-bold" style={{ background: w.icon_url ? undefined : colorFor(w.id) }}>{w.icon_url ? <img src={w.icon_url} alt="" className="h-full w-full object-cover" /> : initials(w.name)}</div>
            <div className="min-w-0"><div className="truncate font-bold" data-widget-name>{w.name}</div><div className="text-xs opacity-90" data-widget-online>{t('{n} Members Online', { n: w.presence_count })}</div></div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Members Online')}</div>
            {w.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1" data-widget-member={m.id}>
                <span className="relative h-7 w-7 shrink-0">
                  {m.avatar_url ? <img src={m.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: colorFor(m.id) }}>{initials(m.username)}</span>}
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-bg-1 ${DOT[m.status] ?? 'bg-success'}`} />
                </span>
                <span className="truncate text-sm">{m.username}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <span className="text-xs text-text-2">{APP_NAME}</span>
            {w.instant_invite && <a href={w.instant_invite} target="_blank" rel="noreferrer" className="btn-primary py-1.5" data-widget-join>{t('Join Server')}</a>}
          </div>
        </>
      )}
    </div>
  )
}
