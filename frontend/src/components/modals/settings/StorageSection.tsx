import { HardDrive } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { formatBytes } from '../../../lib/upload'
import { useT } from '../../../lib/i18n'

interface Storage { used: number; quota: number | null; attachment_bytes: number; image_bytes: number; attachments: number; images: number }

/** "Storage" card in My Account: how much of the upload quota this account uses. */
export default function StorageSection() {
  const [s, setS] = useState<Storage | null>(null)
  const t = useT()
  useEffect(() => { api.get<Storage>('/users/@me/storage').then(setS).catch(() => setS(null)) }, [])
  if (!s) return null
  const pct = s.quota ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 0
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-storage-section data-storage-used={s.used} data-storage-quota={s.quota ?? ''}>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-bg-3 text-text-2 flex items-center justify-center"><HardDrive size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t('Storage')}</h3>
          <p className="text-sm text-text-2">{s.quota ? t('{used} of {quota} used', { used: formatBytes(s.used), quota: formatBytes(s.quota) }) : t('{used} used (no limit)', { used: formatBytes(s.used) })} · {s.attachments === 1 ? t('{n} attachment', { n: s.attachments }) : t('{n} attachments', { n: s.attachments })} ({formatBytes(s.attachment_bytes)}) · {s.images === 1 ? t('{n} profile image', { n: s.images }) : t('{n} profile images', { n: s.images })} ({formatBytes(s.image_bytes)})</p>
        </div>
      </div>
      {s.quota !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} data-storage-bar />
        </div>
      )}
      <p className="text-xs text-text-2">{t('Deleting messages with attachments, or removing your avatar and banner, frees space.')}</p>
    </section>
  )
}
