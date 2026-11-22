import { CheckCircle2, CircleAlert, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import { can, useAccess } from './adminAccess'

interface Rec { decision: 'filed' | 'not_required'; authority: string; reference: string; filed_at: string | null; evidence_preserved: boolean; note: string; recorded_by: string | null; recorded_at: string }
interface State { required: boolean; record: Rec | null }

/** Report categories that cannot be closed until the report to the authorities is dealt with on record. */
export const NEEDS_AUTHORITY = ['child_sexual_content', 'child_grooming']

/** A chosen day as a moment: noon that day, or now when noon has not come yet (a filing is never in the future). */
function filedAt(day: string): string {
  const noon = new Date(`${day}T12:00:00`)
  return (noon > new Date() ? new Date() : noon).toISOString()
}

/** Save a JSON document the server produced as a file on this computer. */
export async function downloadJson(path: string, filename: string) {
  const data = await api.get<unknown>(path)
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * On a report about child sexual content or an adult pursuing a child: the checklist that has to be completed
 * before the report can be closed, and the export of what a hotline form asks for. Parley files nothing itself.
 */
export function AuthorityChecklist({ reportId, onRecorded }: { reportId: string; onRecorded: () => void }) {
  const t = useT()
  const access = useAccess()
  const pushToast = useStore((s) => s.pushToast)
  const lead = can(access, 'safety_match_review')
  const [st, setSt] = useState<State | null>(null)
  const [decision, setDecision] = useState<'filed' | 'not_required'>('filed')
  const [authority, setAuthority] = useState('NCMEC CyberTipline')
  const [reference, setReference] = useState('')
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10))
  const [kept, setKept] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<State>(`/admin/reports/${reportId}/authority`).then(setSt).catch(() => setSt(null)) }, [reportId])
  if (!st) return null
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const save = () => run(async () => {
    setSt(await api.put<State>(`/admin/reports/${reportId}/authority`, decision === 'filed'
      ? { decision, authority, reference, filed_at: filedAt(when), evidence_preserved: kept, note }
      : { decision, note }))
    pushToast(t('Recorded')); onRecorded()
  })
  const ready = decision === 'filed' ? authority.trim() && reference.trim() && when && kept : note.trim().length >= 10
  const r = st.record
  return (
    <div className={`mt-3 rounded-lg border p-3 text-sm ${r ? 'border-success/40 bg-success/5' : 'border-danger/50 bg-danger/5'}`} data-authority={r ? r.decision : 'needed'}>
      <div className="flex items-start gap-2">
        {r ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t('Report to the authorities')}</div>
          {r ? (
            <p className="text-text-2" data-authority-summary>
              {r.decision === 'filed'
                ? t('Filed with {authority} on {date}, reference {reference}. The evidence is on legal hold.', { authority: r.authority, date: r.filed_at ? new Date(r.filed_at).toLocaleDateString() : '', reference: r.reference })
                : t('No report was needed: {why}', { why: r.note })}
              {' '}{t('Recorded by @{name}.', { name: r.recorded_by ?? '?' })}
            </p>
          ) : <p className="text-text-2">{t('This report cannot be closed until a trust-and-safety lead or legal records the report that was made, or that none was needed and why. Parley does not file it for you. In many countries a provider who becomes aware of this material must report it and keep what it holds.')}</p>}
        </div>
        {lead && <button type="button" className="btn-ghost shrink-0 py-1 text-xs" disabled={busy} data-authority-export onClick={() => run(() => downloadJson(`/admin/reports/${reportId}/authority/export`, `report-${reportId}.json`))}><Download size={14} className="mr-1 inline" />{t('Details for the report')}</button>}
      </div>
      {lead && !r && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5"><input type="radio" className="accent-accent" checked={decision === 'filed'} onChange={() => setDecision('filed')} data-authority-filed />{t('A report was filed')}</label>
            <label className="flex items-center gap-1.5"><input type="radio" className="accent-accent" checked={decision === 'not_required'} onChange={() => setDecision('not_required')} data-authority-none />{t('No report was needed')}</label>
          </div>
          {decision === 'filed' ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block"><span className="label">{t('Filed with')}</span><input className="input w-full" value={authority} onChange={(e) => setAuthority(e.target.value)} data-authority-name /></label>
              <label className="block"><span className="label">{t('Reference you were given')}</span><input className="input w-full" value={reference} onChange={(e) => setReference(e.target.value)} data-authority-reference /></label>
              <label className="block"><span className="label">{t('Date filed')}</span><input type="date" className="input w-full" value={when} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setWhen(e.target.value)} data-authority-date /></label>
              <label className="flex items-start gap-2 sm:col-span-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={kept} onChange={(e) => setKept(e.target.checked)} data-authority-kept />
                <span>{t('The evidence is preserved. Recording this puts the report on legal hold, so what was kept is not cleared.')}</span></label>
            </div>
          ) : null}
          <label className="block"><span className="label">{decision === 'filed' ? t('Note (optional)') : t('Why none was needed')}</span><input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} data-authority-note /></label>
          <button type="button" className="btn-primary py-1 text-xs" disabled={busy || !ready} onClick={save} data-authority-save>{t('Record')}</button>
        </div>
      )}
    </div>
  )
}
