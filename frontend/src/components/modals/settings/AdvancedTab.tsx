import { useState } from 'react'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { debugLogging, downloadLogs, entries, setDebugLogging } from '../../../lib/log'
import { isNative } from '../../../lib/native'
import { Toggle } from '../SettingsShell'

/** Settings → Advanced: developer mode, debug logging and log download, platform-only switches. */
export default function AdvancedTab() {
  const p = usePrefs()
  const [debug, setDebug] = useState(debugLogging())
  return (
    <div className="space-y-6" data-advanced-tab>
      <h2 className="text-xl font-bold">Advanced</h2>
      <section className="space-y-3">
        <span data-developer-mode><Toggle label="Developer Mode" checked={p.developerMode} onChange={(v) => setPrefs({ developerMode: v })} /></span>
        <p className="text-xs text-text-2">Adds "Copy Server / Channel / Message / User ID" to context menus, for use with the API.</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-3">
        <span data-debug-logging><Toggle label="Debug logging" checked={debug} onChange={(v) => { setDebugLogging(v); setDebug(v) }} /></span>
        <p className="text-xs text-text-2">Keeps connection and voice events alongside errors and warnings (the last 500 entries, in memory). Download them when reporting a problem.</p>
        <button type="button" onClick={downloadLogs} className="btn-ghost" data-download-logs>Download logs ({entries().length} entries)</button>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-3">
        <Toggle label="Hardware acceleration" checked={true} onChange={() => {}} disabled />
        <p className="text-xs text-text-2">{isNative() ? 'Managed by the operating system on this platform.' : 'Set by your browser (chrome://settings/system or the equivalent); the web app cannot change it.'}</p>
      </section>
    </div>
  )
}
