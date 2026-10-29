import { Check, ExternalLink, X } from 'lucide-react'
import { notificationText } from '../../../lib/desktopNotify'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../lib/api'
import { formatTime } from '../../../lib/format'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

interface GuildReport { id: string; kind: 'message' | 'user'; target_user_id: string | null; target_username: string; message_id: string | null; channel_id: string | null; channel_name: string; content: string; reason: string; mod_status: string; mod_note: string; created_at: string; message_exists: boolean }

/** Server Settings › Reports: what members reported to this server's moderators (who reported stays private). */
export default function ReportsTab({ guildId }: { guildId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const closeModal = useStore((s) => s.closeModal)
  const navigate = useNavigate()
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const [list, setList] = useState<GuildReport[] | null>(null)
  const load = () => api.get<GuildReport[]>(`/guilds/${guildId}/reports?status=${status}`).then(setList).catch(() => setList([]))
  useEffect(() => { setList(null); void load() }, [guildId, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = async (r: GuildReport, mod_status: string) => { try { await api.patch(`/guilds/${guildId}/reports/${r.id}`, { mod_status }); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div data-reports-tab>
      <h1 className="text-xl font-bold">{t('Reports')}</h1>
      <p className="mt-1 text-sm text-text-2">{t("Messages and members reported to this server's moderators. Instance admins see reports too and handle them separately.")}</p>
      <div className="mt-4 mb-3 flex gap-1.5">
        {(['open', 'all'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === s ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-reports-filter={s}>{s === 'open' ? t('Open') : t('All')}</button>)}
      </div>
      {list === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {list?.length === 0 && <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">{status === 'open' ? t('No open reports.') : t('No reports.')}</p>}
      <div className="space-y-2">
        {list?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-bg-1 p-3" data-guild-report={r.id} data-report-status={r.mod_status}>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{r.kind === 'message' ? t('Message by @{user}', { user: r.target_username }) : t('Member by @{user}', { user: r.target_username })}</span>
              {r.channel_name && <span className="text-xs text-text-2">{t('in #{channel}', { channel: r.channel_name })}</span>}
              <span className="ml-auto text-xs text-text-2">{formatTime(r.created_at)}</span>
            </div>
            {r.content && <p className="mt-1 rounded bg-bg-3 px-2 py-1 text-sm text-text-1 break-words">{notificationText(r.content, guildId)}</p>}
            <p className="mt-1 text-xs text-text-2">{t('Reason: {reason}', { reason: r.reason })}</p>
            <div className="mt-2 flex items-center gap-2">
              {r.mod_status === 'open' ? (
                <>
                  <button type="button" className="btn-primary py-1 text-xs" onClick={() => set(r, 'resolved')} data-report-resolve><Check size={13} /> {t('Resolve')}</button>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => set(r, 'dismissed')} data-report-dismiss><X size={13} /> {t('Dismiss')}</button>
                </>
              ) : <span className="text-xs font-semibold uppercase text-text-2">{r.mod_status}</span>}
              {r.message_exists && r.channel_id && r.message_id && <button type="button" className="ml-auto flex items-center gap-1 text-xs text-sky-400 hover:underline" onClick={() => { closeModal(); navigate(`/channels/${guildId}/${r.channel_id}?message=${r.message_id}`) }}><ExternalLink size={12} /> {t('Jump')}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
