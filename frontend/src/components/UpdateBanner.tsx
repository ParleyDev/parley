import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { APP_NAME, APP_VERSION } from '../lib/brand'
import { useT } from '../lib/i18n'
import { desktop } from '../lib/desktop'
import { RELEASES, useDesktopUpdate } from '../lib/desktopUpdate'
import { useTitleBarShown } from '../lib/titleBar'

/** Server version file; null when unavailable (dev server, network error). */
async function servedVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const v = (await r.json())?.version
    return typeof v === 'string' ? v : null
  } catch { return null }
}

/**
 * A client left open across a deploy keeps running the old bundle (old fixes, old link handling). After each
 * reconnect, when the window regains focus, and every 15 minutes, compare the served build with ours and offer
 * a reload when they differ.
 */
export default function UpdateBanner() {
  const t = useT()
  const readyCount = useStore((s) => s.readyCount)
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => {
    if (APP_VERSION === 'dev') return
    let alive = true
    const check = async () => { const v = await servedVersion(); if (alive && v && v !== APP_VERSION) setLatest(v) }
    check()
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    const t = window.setInterval(check, 15 * 60 * 1000)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); window.clearInterval(t) }
  }, [readyCount])
  const app = useDesktopUpdate()
  const titleBar = useTitleBarShown()
  // The desktop app's own update, when there's no title bar to show it in.
  if (!latest && !titleBar && app.kind === 'shell' && app.status.state === 'ready') return (
    <div className="shrink-0 bg-success text-black text-xs font-semibold flex items-center justify-center gap-3 py-1 px-3" data-desktop-update-banner="ready">
      <span>{t('Parley {version} is ready to install.', { version: app.status.version ?? '' })}</span>
      <button type="button" className="inline-flex items-center gap-1 rounded bg-black/15 hover:bg-black/25 px-2 py-0.5" onClick={() => void desktop.installUpdate().catch(() => {})} data-desktop-update-install><RefreshCw size={12} /> {t('Restart to update')}</button>
    </div>
  )
  if (!latest && !titleBar && app.kind === 'download') return (
    <div className="shrink-0 bg-success text-black text-xs font-semibold flex items-center justify-center gap-3 py-1 px-3" data-desktop-update-banner="download">
      <span>{t('A new version of the Parley app is out ({version}).', { version: app.version })}</span>
      <a href={RELEASES} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-black/15 hover:bg-black/25 px-2 py-0.5">{t('Download')}</a>
    </div>
  )
  if (!latest) return null
  // Phones: a full-height bar with a short line and a thumb-sized Reload button.
  return (
    <div className="shrink-0 bg-accent text-white text-xs font-semibold flex items-center justify-center gap-3 py-1 px-3 phone:justify-between phone:py-2 phone:pl-4 phone:pr-2 phone:text-[15px]" data-update-banner={latest}>
      <span className="phone:hidden">{t('A new version of {app} is available ({version}).', { app: APP_NAME, version: latest })}</span>
      <span className="wide:hidden min-w-0">{t('A new version is available.')}</span>
      <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded bg-white/20 hover:bg-white/30 px-2 py-0.5 phone:h-10 phone:gap-2 phone:rounded-lg phone:px-4 phone:text-[15px]" onClick={() => location.reload()} data-update-reload><RefreshCw size={12} className="phone:hidden" /><RefreshCw size={18} className="wide:hidden" /> {t('Reload')}</button>
    </div>
  )
}
