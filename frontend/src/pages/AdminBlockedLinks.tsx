import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

interface Blocked { domain: string; reason: string; created_at: string }

/** Admin › Blocked Links: domains nobody can post links to (and subdomains), e.g. IP loggers and phishing sites. */
export default function BlockedLinksPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Blocked[] | null>(null)
  const [domain, setDomain] = useState('')
  const [reason, setReason] = useState('')
  const load = () => api.get<Blocked[]>('/admin/blocked-domains').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const add = async () => { try { await api.post('/admin/blocked-domains', { domain, reason }); setDomain(''); setReason(''); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const remove = async (d: string) => { try { await api.delete(`/admin/blocked-domains/${encodeURIComponent(d)}`); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="max-w-2xl space-y-5" data-admin-blocked-links>
      <div><h1 className="text-xl font-bold">{t('Blocked Links')}</h1><p className="mt-1 text-sm text-text-2">{t('Messages linking to these sites (or their subdomains) are refused everywhere on this instance.')}</p></div>
      <div className="flex flex-wrap gap-2">
        <input className="input w-56" placeholder="bad.example" value={domain} onChange={(e) => setDomain(e.target.value)} data-blocked-domain-input />
        <input className="input flex-1 min-w-40" placeholder={t('Why (optional)')} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" className="btn-primary" disabled={!domain.trim()} onClick={add} data-blocked-domain-add>{t('Block')}</button>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {list === null && <p className="p-3 text-sm text-text-2">{t('Loading…')}</p>}
        {list?.map((b) => (
          <div key={b.domain} className="flex items-center gap-3 px-3 py-2 text-sm" data-blocked-domain={b.domain}>
            <span className="font-mono">{b.domain}</span><span className="flex-1 truncate text-text-2">{b.reason}</span>
            <button type="button" onClick={() => remove(b.domain)} className="text-text-2 hover:text-danger" title={t('Unblock')}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
