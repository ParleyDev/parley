import { AlertTriangle, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { useStore } from '../../store'
import { openExternal } from '../../lib/native'
import { hostOf, spoofedHost, trustHost } from '../../lib/links'
import { APP_NAME } from '../../lib/brand'
import { useT, tn } from '../../lib/i18n'

/** "Leaving Parley": the real destination, spelled out, before anything opens outside the app. */
export default function LeaveLinkModal({ onClose, url, text }: { onClose: () => void; url: string; text?: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [trust, setTrust] = useState(false)
  let parsed: URL | null = null
  try { parsed = new URL(url) } catch { parsed = null }
  const host = parsed ? hostOf(parsed) : url
  const spoof = parsed ? spoofedHost(text, parsed) : null
  // Punycode hosts (xn--) can look like well-known names when rendered as Unicode; show the ASCII form too.
  const ascii = parsed?.hostname ?? ''
  const unicode = (() => { try { return decodeURIComponent(ascii) } catch { return ascii } })()
  const idn = ascii.includes('xn--')
  const go = () => { if (trust && parsed) trustHost(parsed); onClose(); openExternal(url) }
  const copy = async () => { try { await navigator.clipboard.writeText(url); pushToast(t('Link copied')) } catch { pushToast(t('Clipboard unavailable'), 'error') } }
  return (
    <Modal title={t('Leaving {app}', { app: APP_NAME })} onClose={onClose} footer={<><button type="button" className="btn-ghost mr-auto" onClick={copy} data-leave-copy><Copy size={14} /> {t('Copy link')}</button><button type="button" className="btn-ghost" onClick={onClose} data-leave-cancel>{t('Go back')}</button><button type="button" className={`btn-primary ${spoof || idn ? 'bg-danger hover:bg-danger/80' : ''}`} onClick={go} data-leave-visit><ExternalLink size={14} /> {t('Visit site')}</button></>}>
      <div className="space-y-3" data-leave-link>
        <p className="text-sm text-text-1">{t('This link takes you to another site. {app} cannot vouch for it: only open links from people you trust, and never enter your {app} password anywhere else.', { app: APP_NAME })}</p>
        <div className="rounded-lg border border-line bg-bg-0 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Destination')}</div>
          <div className="text-lg font-bold break-all" data-leave-host>{host}</div>
          {idn && <div className="text-xs text-warn">{t('Internationalised domain, shown as typed:')} <code className="break-all">{unicode}</code></div>}
          <code className="mt-1 block break-all text-xs text-text-1" data-leave-url>{url}</code>
        </div>
        {spoof && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm" data-leave-spoof>
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>{tn('The link text says {spoof} but it actually goes to {host}. That is how phishing works. Be careful.', { spoof: <b>{spoof}</b>, host: <b>{parsed?.hostname}</b> })}</span>
          </div>
        )}
        {parsed?.protocol.startsWith('http') && !spoof && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="accent-accent" data-leave-trust /> {tn("Trust {host} and don't ask again", { host: <b>{host}</b> })}</label>}
      </div>
    </Modal>
  )
}
