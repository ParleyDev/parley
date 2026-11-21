import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { formatBytes } from '../lib/upload'

/** How each kind of report is named in the console. */
export const REPORT_CATEGORIES: Record<string, string> = {
  spam: 'Spam or scam', harassment: 'Harassment or hate', explicit: 'Explicit or disturbing content', illegal: 'Illegal activity', other: 'Something else',
  child_sexual_content: 'Sexual content involving a child', child_grooming: 'An adult pursuing a child', minor_in_adult_space: 'A child in an 18+ space', underage_user: 'Underage account',
  intimate_image: 'Intimate image without consent', threat: 'Threat of violence', self_harm: 'Self-harm',
}

interface Msg { id: string; author: string; content: string; created_at: string; edited_at: string | null; attachments: { id: string; filename: string; content_type: string; size: number }[] }
interface Evidence {
  evidence: { captured_at: string; profile: { username: string; display_name: string | null; bio: string | null; created_at: string } | null; channel?: { private: boolean; age_restricted: boolean }; message?: Msg | null; before?: Msg[]; after?: Msg[] } | null
  legal_hold: boolean
  retention_days: number
  files: { attachment_id: string; filename: string; content_type: string; size: number; sha256: string; kept: boolean }[]
}

function Line({ m, reported }: { m: Msg; reported?: boolean }) {
  const t = useT()
  return (
    <div className={`rounded px-2 py-1 text-sm ${reported ? 'bg-warn/10 ring-1 ring-warn/40' : ''}`} data-evidence-line={reported ? 'reported' : 'around'}>
      <span className="font-semibold">@{m.author}</span> <span className="text-[11px] text-text-2">{new Date(m.created_at).toLocaleString()}{m.edited_at && ` · ${t('edited')}`}</span>
      <div className="whitespace-pre-wrap break-words">{m.content || <i className="text-text-2">{t('(no text)')}</i>}</div>
      {m.attachments.map((f) => <div key={f.id} className="text-xs text-text-2">{f.filename} · {f.content_type} · {formatBytes(f.size)}</div>)}
    </div>
  )
}

/**
 * What was copied when a report was filed: the reported account as it looked then, the message and what was said
 * around it, and the details of the message's files. It stays as it was even if the message or account changes or
 * is deleted. Files are described, never shown.
 */
export default function ReportEvidence({ reportId }: { reportId: string }) {
  const t = useT()
  const [data, setData] = useState<Evidence | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get<Evidence>(`/admin/reports/${reportId}/evidence`).then(setData).catch((e) => setError((e as Error).message)) }, [reportId])
  if (error) return <p className="mt-3 text-sm text-danger">{error}</p>
  if (!data) return <p className="mt-3 text-sm text-text-2">{t('Loading…')}</p>
  const ev = data.evidence
  return (
    <div className="mt-3 rounded-lg border border-line bg-bg-0/60 p-3 text-sm" data-report-evidence>
      {!ev ? <p className="text-text-2" data-evidence-gone>{t('The copy kept with this report has been cleared.')}</p> : (
        <>
          <div className="text-xs text-text-2" data-evidence-when>{t('Copied when the report was sent: {when}', { when: new Date(ev.captured_at).toLocaleString() })}</div>
          {ev.profile && (
            <div className="mt-2" data-evidence-profile>
              <div className="text-[11px] font-bold uppercase text-text-2">{t('Reported account')}</div>
              <div><b>@{ev.profile.username}</b>{ev.profile.display_name && ` (${ev.profile.display_name})`} <span className="text-xs text-text-2">· {t('joined {date}', { date: new Date(ev.profile.created_at).toLocaleDateString() })}</span></div>
              {ev.profile.bio && <div className="whitespace-pre-wrap break-words text-text-1">{ev.profile.bio}</div>}
            </div>
          )}
          {ev.message && (
            <div className="mt-2" data-evidence-messages>
              <div className="text-[11px] font-bold uppercase text-text-2">{ev.channel?.private ? t('Reported message (direct message)') : t('Reported message and what was said around it')}{ev.channel?.age_restricted && ` · ${t('18+ channel')}`}</div>
              <div className="mt-1 space-y-0.5">
                {ev.before?.map((m) => <Line key={m.id} m={m} />)}
                <Line m={ev.message} reported />
                {ev.after?.map((m) => <Line key={m.id} m={m} />)}
              </div>
            </div>
          )}
        </>
      )}
      {data.files.length > 0 && (
        <div className="mt-2" data-evidence-files>
          <div className="text-[11px] font-bold uppercase text-text-2">{t('Files on the reported message')}</div>
          {data.files.map((f) => (
            <div key={f.attachment_id} className="mt-1 text-xs" data-evidence-file={f.kept ? 'kept' : 'gone'}>
              <div>{f.filename} · {f.content_type} · {formatBytes(f.size)} · <span className={f.kept ? 'text-success' : 'text-text-2'}>{f.kept ? t('copy held') : t('no copy held')}</span></div>
              {f.sha256 && <div className="break-all font-mono text-[10px] text-text-2">SHA-256 {f.sha256}</div>}
            </div>
          ))}
          <p className="mt-1 text-xs text-text-2">{t('Held copies are kept on the server for the authorities and are never shown here.')}</p>
        </div>
      )}
      <p className="mt-2 text-xs text-text-2" data-evidence-retention>
        {data.legal_hold ? t('On legal hold: kept until the hold is lifted.') : data.retention_days > 0 ? t('Cleared {days} days after the report is closed, unless it is put on legal hold.', { days: data.retention_days }) : t('Kept until removed by hand.')}
      </p>
    </div>
  )
}
