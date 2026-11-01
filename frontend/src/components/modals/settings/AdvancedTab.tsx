import { useEffect, useState } from 'react'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { debugLogging, downloadLogs, entries, setDebugLogging } from '../../../lib/log'
import { isNative } from '../../../lib/native'
import { desktop, desktopBridge, type DesktopSettings } from '../../../lib/desktop'
import { useStore } from '../../../store'
import { Toggle } from '../SettingsShell'
import { tn, useT } from '../../../lib/i18n'
import { prettyCombo, useKeybindMap } from '../../../lib/keybinds'
import { checkForUpdate, RELEASES, useDesktopUpdate } from '../../../lib/desktopUpdate'
import Dropdown from '../../Dropdown'

/** Settings → Advanced: developer mode, debug logging and log download, platform-only switches. */
export default function AdvancedTab() {
  const t = useT()
  const p = usePrefs()
  const kb = useKeybindMap()
  const [debug, setDebug] = useState(debugLogging())
  const pushToast = useStore((s) => s.pushToast)
  const [ds, setDs] = useState<DesktopSettings | null>(null)
  const [hwAtLaunch, setHwAtLaunch] = useState<boolean | null>(null)
  useEffect(() => { if (desktopBridge()) void desktop.settings().then((s) => { setDs(s); setHwAtLaunch(s.hardware_acceleration) }).catch(() => {}) }, [])
  const change = (patch: { autostart?: boolean; startMinimized?: boolean; hardwareAcceleration?: boolean; closeToTray?: boolean; minimizeToTray?: boolean; updateChannel?: 'stable' | 'dev' }) => { void desktop.setSettings(patch).then(setDs).catch((e) => pushToast(String((e as Error).message ?? e), 'error')) }
  return (
    <div className="space-y-6" data-advanced-tab>
      <h2 className="text-xl font-bold">{t('Advanced')}</h2>
      <section className="space-y-3">
        <span className="block" data-developer-mode><Toggle label={t('Developer Mode')} checked={p.developerMode} onChange={(v) => setPrefs({ developerMode: v })} /></span>
        <p className="text-xs text-text-2">{t('Adds "Copy Server / Channel / Message / User ID" to context menus, for use with the API.')}</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-3">
        <span className="block" data-debug-logging><Toggle label={t('Debug logging')} checked={debug} onChange={(v) => { setDebugLogging(v); setDebug(v) }} /></span>
        <p className="text-xs text-text-2">{t('Keeps connection and voice events alongside errors and warnings (the last 500 entries, in memory). Download them when reporting a problem.')}</p>
        <button type="button" onClick={downloadLogs} className="btn-ghost" data-download-logs>{t('Download logs ({n} entries)', { n: entries().length })}</button>
      </section>
      <div className="h-px bg-line" />
      {ds && <>
        <section className="space-y-3" data-desktop-settings>
          <label className="label">{t('Desktop app')}</label>
          <span className="block" data-desktop-autostart><Toggle label={t('Open Parley when you sign in to your computer')} checked={ds.autostart} onChange={(v) => change({ autostart: v })} /></span>
          <span className="block" data-desktop-minimized><Toggle label={t('Start minimized')} checked={ds.start_minimized} onChange={(v) => change({ startMinimized: v })} disabled={!ds.autostart} /></span>
          <span className="block" data-desktop-overlay><Toggle label={t('In-game overlay')} checked={p.overlay} onChange={(v) => setPrefs({ overlay: v })} /></span>
          <span className="block" data-desktop-overlay-locked><Toggle label={t('Clicks go through the overlay')} checked={p.overlayLocked} onChange={(v) => setPrefs({ overlayLocked: v })} disabled={!p.overlay} /></span>
          <p className="text-xs text-text-2">{tn('During calls, a small window stays on top of games and other apps showing who is in the call and who is talking. Toggle it with {combo}. Turn off click-through to move it by its top bar.', { combo: <b>{prettyCombo(kb.toggleOverlay)}</b> })}</p>
          {ds.tray && <>
            <span className="block" data-desktop-close-tray><Toggle label={t('Close to tray')} checked={ds.close_to_tray ?? true} onChange={(v) => change({ closeToTray: v })} /></span>
            <span className="block" data-desktop-minimize-tray><Toggle label={t('Minimize to tray')} checked={!!ds.minimize_to_tray} onChange={(v) => change({ minimizeToTray: v })} /></span>
          </>}
          <p className="text-xs text-text-2">{ds.tray ? t('Closing the window keeps Parley running in the tray, so calls and notifications carry on; quit from the tray icon.') + ' ' : ''}{t('Starts quietly in the background with your computer. Zoom with Ctrl + = / - / 0 (⌘ on a Mac); Appearance → Zoom level sets it too.')}</p>
        </section>
        <div className="h-px bg-line" />
        <AppUpdates version={ds.version} channel={ds.update_channel} onChannel={(c) => { change({ updateChannel: c }); setTimeout(() => void checkForUpdate(), 300) }} />
        <div className="h-px bg-line" />
      </>}
      <section className="space-y-3">
        {ds
          ? <span className="block" data-desktop-hwaccel><Toggle label={t('Hardware acceleration')} checked={ds.hardware_acceleration} onChange={(v) => change({ hardwareAcceleration: v })} /></span>
          : <Toggle label={t('Hardware acceleration')} checked={true} onChange={() => {}} disabled />}
        <p className="text-xs text-text-2">{ds ? <>{t('Uses your graphics card to draw Parley. Turn it off if the window flickers, stays blank or video looks wrong.')}{hwAtLaunch !== null && hwAtLaunch !== ds.hardware_acceleration && <b className="text-warn" data-desktop-restart> {t('Restart Parley to apply.')}</b>}</> : isNative() ? t('Managed by the operating system on this platform.') : t('Set by your browser (chrome://settings/system or the equivalent); the web app cannot change it.')}</p>
      </section>
    </div>
  )
}

/** The desktop app's version and updates: check now, restart into a downloaded update, or (AppImage-less Linux,
 *  apps from before the updater) a link to download the new version. */
function AppUpdates({ version, channel, onChannel }: { version: string; channel?: 'stable' | 'dev'; onChannel: (c: 'stable' | 'dev') => void }) {
  const t = useT()
  const u = useDesktopUpdate()
  const s = u.kind === 'shell' ? u.status : null
  const pct = s?.total ? Math.round((s.downloaded / s.total) * 100) : null
  const line = u.kind === 'download' ? t('Version {version} is out. This app can\'t update itself: download the new one.', { version: u.version })
    : !s ? t('Updates are checked automatically.')
    : s.state === 'checking' ? t('Checking for updates…')
    : s.state === 'downloading' ? (pct !== null ? t('Downloading {version}… {pct}%', { version: s.version ?? '', pct }) : t('Downloading {version}…', { version: s.version ?? '' }))
    : s.state === 'ready' ? t('Version {version} is downloaded. Restart Parley to finish updating.', { version: s.version ?? '' })
    : s.state === 'none' ? t('Parley is up to date.')
    : s.state === 'unsupported' ? t('This install updates through your package manager, or download the latest version.')
    : s.state === 'error' ? t('Couldn\'t check for updates: {error}', { error: s.error ?? '' })
    : t('Updates are checked automatically.')
  return (
    <section className="space-y-3" data-app-updates={s?.state ?? u.kind}>
      <label className="label">{t('App updates')}</label>
      <p className="text-sm text-text-1">{t('Parley desktop {version}', { version: s?.current || version })}</p>
      {channel && s && s.state !== 'unsupported' && (
        <div>
          <label className="label" htmlFor="update-channel">{t('Update channel')}</label>
          <Dropdown id="update-channel" className="input w-auto" value={channel} onChange={(e) => onChannel(e.target.value as 'stable' | 'dev')} data-update-channel>
            <option value="stable">{t('Stable: releases only')}</option>
            <option value="dev">{t('Development: every new build')}</option>
          </Dropdown>
          <p className="mt-1 text-xs text-text-2">{t('Development builds arrive as soon as they are made and may have rough edges. Switching back to Stable waits for the next release rather than going back.')}</p>
        </div>
      )}
      <p className="text-sm text-text-2" data-app-update-line>{line}</p>
      {s?.state === 'downloading' && pct !== null && <div className="h-1.5 rounded-full bg-bg-4 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
      <div className="flex flex-wrap gap-2">
        {s?.state === 'ready'
          ? <button type="button" className="btn-primary" onClick={() => void desktop.installUpdate().catch(() => {})} data-app-update-install>{t('Restart to update')}</button>
          : s && s.state !== 'unsupported' && <button type="button" className="btn-ghost bg-bg-3" disabled={s.state === 'checking' || s.state === 'downloading'} onClick={() => void checkForUpdate()} data-app-update-check>{t('Check for updates')}</button>}
        {(u.kind === 'download' || s?.state === 'unsupported' || s?.state === 'error') && <a href={RELEASES} target="_blank" rel="noreferrer" className="btn-ghost bg-bg-3" data-app-update-download>{t('Download the latest version')}</a>}
      </div>
    </section>
  )
}
