import { useEffect, useState } from 'react'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { debugLogging, downloadLogs, entries, setDebugLogging } from '../../../lib/log'
import { isNative } from '../../../lib/native'
import { desktop, desktopBridge, type DesktopSettings } from '../../../lib/desktop'
import { useStore } from '../../../store'
import { Toggle } from '../SettingsShell'

/** Settings → Advanced: developer mode, debug logging and log download, platform-only switches. */
export default function AdvancedTab() {
  const p = usePrefs()
  const [debug, setDebug] = useState(debugLogging())
  const pushToast = useStore((s) => s.pushToast)
  const [ds, setDs] = useState<DesktopSettings | null>(null)
  const [hwAtLaunch, setHwAtLaunch] = useState<boolean | null>(null)
  useEffect(() => { if (desktopBridge()) void desktop.settings().then((s) => { setDs(s); setHwAtLaunch(s.hardware_acceleration) }).catch(() => {}) }, [])
  const change = (patch: { autostart?: boolean; startMinimized?: boolean; hardwareAcceleration?: boolean }) => { void desktop.setSettings(patch).then(setDs).catch((e) => pushToast(String((e as Error).message ?? e), 'error')) }
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
      {ds && <>
        <section className="space-y-3" data-desktop-settings>
          <label className="label">Desktop app</label>
          <span data-desktop-autostart><Toggle label="Open Parley when you sign in to your computer" checked={ds.autostart} onChange={(v) => change({ autostart: v })} /></span>
          <span data-desktop-minimized><Toggle label="Start minimized" checked={ds.start_minimized} onChange={(v) => change({ startMinimized: v })} disabled={!ds.autostart} /></span>
          <p className="text-xs text-text-2">Starts quietly in the background with your computer. Zoom with Ctrl + = / - / 0 (⌘ on a Mac); Appearance → Zoom level sets it too.</p>
        </section>
        <div className="h-px bg-line" />
      </>}
      <section className="space-y-3">
        {ds
          ? <span data-desktop-hwaccel><Toggle label="Hardware acceleration" checked={ds.hardware_acceleration} onChange={(v) => change({ hardwareAcceleration: v })} /></span>
          : <Toggle label="Hardware acceleration" checked={true} onChange={() => {}} disabled />}
        <p className="text-xs text-text-2">{ds ? <>Uses your graphics card to draw Parley. Turn it off if the window flickers, stays blank or video looks wrong.{hwAtLaunch !== null && hwAtLaunch !== ds.hardware_acceleration && <b className="text-warn" data-desktop-restart> Restart Parley to apply.</b>}</> : isNative() ? 'Managed by the operating system on this platform.' : 'Set by your browser (chrome://settings/system or the equivalent); the web app cannot change it.'}</p>
      </section>
    </div>
  )
}
