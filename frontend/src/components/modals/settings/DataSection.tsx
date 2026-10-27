import { Download, FileJson } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

interface Export { id: string; status: 'pending' | 'ready' | 'failed'; requested_at: string; ready_at: string | null; size: number; error: string | null }

const fmtSize = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`

/** "Your data": request a copy of everything we hold about you, and download it when ready (kept 7 days). */
export default function DataSection() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const token = useStore((s) => s.token)
  const [list, setList] = useState<Export[]>([])
  const [busy, setBusy] = useState(false)
  const load = () => api.get<Export[]>('/users/@me/data-exports').then(setList).catch(() => {})
  useEffect(() => { void load() }, [])
  const pending = list.some((e) => e.status === 'pending')
  useEffect(() => { if (!pending) return; const timer = setInterval(load, 2000); return () => clearInterval(timer) }, [pending])
  const request = async () => {
    setBusy(true)
    try { await api.post('/users/@me/data-exports', {}); pushToast(t('Export started. We will email you when it is ready.')); await load() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const download = async (e: Export) => {
    try {
      const res = await fetch(`/api/users/@me/data-exports/${e.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(t('Download failed'))
      const blob = await res.blob(); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `parley-data-${e.requested_at.slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url)
    } catch (err) { pushToast((err as Error).message, 'error') }
  }
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-data-section>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-bg-3 text-text-1 flex items-center justify-center"><FileJson size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t('Your data')}</h3>
          <p className="text-sm text-text-2">{t('Request a copy of everything this server holds about you: your account, servers, messages, relationships and settings, as one JSON file. It is ready within minutes, kept for 7 days, and you can ask once a day.')}</p>
        </div>
      </div>
      <button type="button" onClick={request} disabled={busy || pending} className="btn-primary py-1.5 disabled:opacity-50" data-export-request>{pending ? t('Preparing…') : t('Request all of my data')}</button>
      {list.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg-1 text-sm">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2" data-export={e.id} data-export-status={e.status}>
              <span className="min-w-0 flex-1 truncate">{t('Requested {when}', { when: new Date(e.requested_at).toLocaleString() })}{e.status === 'ready' && ` · ${fmtSize(e.size)}`}{e.status === 'failed' && <span className="text-danger"> · {t('failed')}{e.error ? `: ${e.error}` : ''}</span>}</span>
              {e.status === 'pending' ? <span className="text-xs text-text-2">{t('Preparing…')}</span>
                : e.status === 'ready' ? <button type="button" onClick={() => download(e)} className="btn-ghost py-1 text-xs" data-export-download><Download size={14} /> {t('Download')}</button>
                : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
