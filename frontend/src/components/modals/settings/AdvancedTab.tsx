import { useEffect, useState } from 'react'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { debugLogging, downloadLogs, entries, setDebugLogging } from '../../../lib/log'
import { isNative } from '../../../lib/native'
import { desktop, desktopBridge, type DesktopSettings } from '../../../lib/desktop'
import { useStore } from '../../../store'
import { Toggle } from '../SettingsShell'
import { useT } from '../../../lib/i18n'

/** Settings → Advanced: developer mode, debug logging and log download, platform-only switches. */
export default function AdvancedTab() {
  const t = useT()
  const p = usePrefs()
  const [debug, setDebug] = useState(debugLogging())
  const pushToast = useStore((s) => s.pushToast)
  const [ds, setDs] = useState<DesktopSettings | null>(null)
  const [hwAtLaunch, setHwAtLaunch] = useState<boolean | null>(null)
  useEffect(() => { if (desktopBridge()) void desktop.settings().then((s) => { setDs(s); setHwAtLaunch(s.hardware_acceleration) }).catch(() => {}) }, [])
  const change = (patch: { autostart?: boolean; startMinimized?: boolean; hardwareAcceleration?: boolean; closeToTray?: boolean; minimizeToTray?: boolean }) => { void desktop.setSettings(patch).then(setDs).catch((e) => pushToast(String((e as Error).message ?? e), 'error')) }
  return (
    <div className="space-y-6" data-advanced-tab>
      <h2 className="text-xl font-bold">{t('Advanced')}</h2>
      <section className="space-y-3">
        <span data-developer-mode><Toggle label={t('Developer Mode')} checked={p.developerMode} onChange={(v) => setPrefs({ developerMode: v })} /></span>
        <p className="text-xs text-text-2">{t('Adds "Copy Server / Channel / Message / User ID" to context menus, for use with the API.')}</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-3">
        <span data-debug-logging><Toggle label={t('Debug logging')} checked={debug} onChange={(v) => { setDebugLogging(v); setDebug(v) }} /></span>
        <p className="text-xs text-text-2">{t('Keeps connection and voice events alongside errors and warnings (the last 500 entries, in memory). Download them when reporting a problem.')}</p>
        <button type="button" onClick={downloadLogs} className="btn-ghost" data-download-logs>{t('Download logs ({n} entries)', { n: entries().length })}</button>
      </section>
      <div className="h-px bg-line" />
      {ds && <>
        <section className="space-y-3" data-desktop-settings>
          <label className="label">{t('Desktop app')}</label>
          <span data-desktop-autostart><Toggle label={t('Open Parley when you sign in to your computer')} checked={ds.autostart} onChange={(v) => change({ autostart: v })} /></span>
          <span data-desktop-minimized><Toggle label={t('Start minimized')} checked={ds.start_minimized} onChange={(v) => change({ startMinimized: v })} disabled={!ds.autostart} /></span>
          {ds.tray && <>
            <span data-desktop-close-tray><Toggle label={t('Close to tray')} checked={ds.close_to_tray ?? true} onChange={(v) => change({ closeToTray: v })} /></span>
            <span data-desktop-minimize-tray><Toggle label={t('Minimize to tray')} checked={!!ds.minimize_to_tray} onChange={(v) => change({ minimizeToTray: v })} /></span>
          </>}
          <p className="text-xs text-text-2">{ds.tray ? t('Closing the window keeps Parley running in the tray, so calls and notifications carry on; quit from the tray icon.') + ' ' : ''}{t('Starts quietly in the background with your computer. Zoom with Ctrl + = / - / 0 (⌘ on a Mac); Appearance → Zoom level sets it too.')}</p>
        </section>
        <div className="h-px bg-line" />
      </>}
      <section className="space-y-3">
        {ds
          ? <span data-desktop-hwaccel><Toggle label={t('Hardware acceleration')} checked={ds.hardware_acceleration} onChange={(v) => change({ hardwareAcceleration: v })} /></span>
          : <Toggle label={t('Hardware acceleration')} checked={true} onChange={() => {}} disabled />}
        <p className="text-xs text-text-2">{ds ? <>{t('Uses your graphics card to draw Parley. Turn it off if the window flickers, stays blank or video looks wrong.')}{hwAtLaunch !== null && hwAtLaunch !== ds.hardware_acceleration && <b className="text-warn" data-desktop-restart> {t('Restart Parley to apply.')}</b>}</> : isNative() ? t('Managed by the operating system on this platform.') : t('Set by your browser (chrome://settings/system or the equivalent); the web app cannot change it.')}</p>
      </section>
    </div>
  )
}
