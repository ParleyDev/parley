import { setPrefs, usePrefs } from '../../../lib/prefs'
import { useKeybindMap, prettyCombo } from '../../../lib/keybinds'
import { isNative } from '../../../lib/native'
import { desktopBridge } from '../../../lib/desktop'
import { Toggle } from '../SettingsShell'
import { useT, tn } from '../../../lib/i18n'

/** Settings → Streamer Mode: hide what a stream should not show, and go quiet. */
export default function StreamerTab() {
  const t = useT()
  const p = usePrefs()
  const kb = useKeybindMap()
  return (
    <div className="space-y-6" data-streamer-tab>
      <h2 className="text-xl font-bold">{t('Streamer Mode')}</h2>
      <p className="text-sm text-text-2">{tn('For when the app is on screen: hides your email and other personal details, blurs invite links and codes, and keeps sounds and notifications from interrupting. Toggle it with {combo} (Keybinds) or the banner.', { combo: <b>{prettyCombo(kb.toggleStreamer)}</b> })}</p>
      <section className="space-y-3">
        <span data-streamer-toggle><Toggle label="Enable Streamer Mode" checked={p.streamer} onChange={(v) => setPrefs({ streamer: v })} /></span>
        <span data-streamer-auto><Toggle label="Automatically enable when OBS or XSplit is running" checked={desktopBridge() && p.streamerAuto} onChange={(v) => setPrefs({ streamerAuto: v })} disabled={!desktopBridge()} /></span>
        <p className="text-xs text-text-2">{desktopBridge() ? t('Turns Streamer Mode on when OBS, Streamlabs or XSplit starts, and back off when it quits.') : isNative() ? t('Not available on this platform yet.') : t('Only the desktop app can see other programs; a browser cannot.')}</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-3">
        <Toggle label="Hide personal information" checked={p.streamerHideInfo} onChange={(v) => setPrefs({ streamerHideInfo: v })} />
        <p className="text-xs text-text-2">{t('Masks your email in My Account and in mails shown on screen.')}</p>
        <Toggle label="Hide invite links" checked={p.streamerHideInvites} onChange={(v) => setPrefs({ streamerHideInvites: v })} />
        <p className="text-xs text-text-2">{t('Invite links in chat and the Invite dialog are blurred (they still copy).')}</p>
        <Toggle label="Disable sounds" checked={p.streamerMuteSounds} onChange={(v) => setPrefs({ streamerMuteSounds: v })} />
        <Toggle label="Disable notifications" checked={p.streamerMuteNotifications} onChange={(v) => setPrefs({ streamerMuteNotifications: v })} />
        <p className="text-xs text-text-2">{t('Desktop notifications, sounds and text-to-speech stay quiet while Streamer Mode is on.')}</p>
      </section>
    </div>
  )
}
