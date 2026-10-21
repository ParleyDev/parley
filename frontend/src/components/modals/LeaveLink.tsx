import { AlertTriangle, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { useStore } from '../../store'
import { openExternal } from '../../lib/native'
import { hostOf, spoofedHost, trustHost } from '../../lib/links'
import { APP_NAME } from '../../lib/brand'

/** "Leaving Parley": the real destination, spelled out, before anything opens outside the app. */
export default function LeaveLinkModal({ onClose, url, text }: { onClose: () => void; url: string; text?: string }) {
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
  const copy = async () => { try { await navigator.clipboard.writeText(url); pushToast('Link copied') } catch { pushToast('Clipboard unavailable', 'error') } }
  return (
    <Modal title={`Leaving ${APP_NAME}`} onClose={onClose} footer={<><button type="button" className="btn-ghost mr-auto" onClick={copy} data-leave-copy><Copy size={14} /> Copy link</button><button type="button" className="btn-ghost" onClick={onClose} data-leave-cancel>Go back</button><button type="button" className={`btn-primary ${spoof || idn ? 'bg-danger hover:bg-danger/80' : ''}`} onClick={go} data-leave-visit><ExternalLink size={14} /> Visit site</button></>}>
      <div className="space-y-3" data-leave-link>
        <p className="text-sm text-text-1">This link takes you to another site. {APP_NAME} cannot vouch for it: only open links from people you trust, and never enter your {APP_NAME} password anywhere else.</p>
        <div className="rounded-lg border border-line bg-bg-0 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-2">Destination</div>
          <div className="text-lg font-bold break-all" data-leave-host>{host}</div>
          {idn && <div className="text-xs text-warn">Internationalised domain, shown as typed: <code className="break-all">{unicode}</code></div>}
          <code className="mt-1 block break-all text-xs text-text-1" data-leave-url>{url}</code>
        </div>
        {spoof && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm" data-leave-spoof>
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>The link text says <b>{spoof}</b> but it actually goes to <b>{parsed?.hostname}</b>. That is how phishing works. Be careful.</span>
          </div>
        )}
        {parsed?.protocol.startsWith('http') && !spoof && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="accent-accent" data-leave-trust /> Trust <b>{host}</b> and don't ask again</label>}
      </div>
    </Modal>
  )
}
