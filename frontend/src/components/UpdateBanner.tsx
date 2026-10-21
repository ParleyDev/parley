import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { APP_NAME, APP_VERSION } from '../lib/brand'

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
  if (!latest) return null
  return (
    <div className="shrink-0 bg-accent text-white text-xs font-semibold flex items-center justify-center gap-3 py-1 px-3" data-update-banner={latest}>
      <span>A new version of {APP_NAME} is available ({latest}).</span>
      <button type="button" className="inline-flex items-center gap-1 rounded bg-white/20 hover:bg-white/30 px-2 py-0.5" onClick={() => location.reload()} data-update-reload><RefreshCw size={12} /> Reload</button>
    </div>
  )
}
