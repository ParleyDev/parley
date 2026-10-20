import { Play } from 'lucide-react'
import { useState } from 'react'
import { Toggle } from '../SettingsShell'
import { SOUND_LABELS, setNotifPrefs, setSound, useNotifPrefs, type SoundKey } from '../../../lib/notifPrefs'
import { playSfx } from '../../../lib/sfx'

/** Settings → Notifications: desktop notifications and one switch per sound, Discord-style. */
export default function NotificationsTab() {
  const prefs = useNotifPrefs()
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported')
  const ask = () => { if (!supported) return; Notification.requestPermission().then((p) => setPerm(p)).catch(() => {}) }
  const all = (on: boolean) => setNotifPrefs({ sounds: Object.fromEntries(SOUND_LABELS.map((s) => [s.key, on])) as Record<SoundKey, boolean> })
  const onCount = SOUND_LABELS.filter((s) => prefs.sounds[s.key]).length
  return (
    <div className="space-y-6" data-notifications-tab>
      <h2 className="text-xl font-bold">Notifications</h2>

      <section className="space-y-3">
        <Toggle label="Enable Desktop Notifications" checked={prefs.desktop} onChange={(v) => { setNotifPrefs({ desktop: v }); if (v && perm === 'default') ask() }} />
        <p className="text-xs text-text-2">
          A system notification for a message that would notify you (a DM, a mention, or a channel you have notifications on for) while this tab is in the background.
          {perm === 'denied' && <span className="text-danger"> Blocked by the browser: allow notifications for this site to use them.</span>}
          {perm === 'default' && <> <button type="button" onClick={ask} className="text-sky-400 hover:underline" data-notif-permission>Allow notifications…</button></>}
          {perm === 'unsupported' && <span> Not supported in this browser.</span>}
        </p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3" data-sound-settings>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">Sounds</h3>
            <p className="text-xs text-text-2">{onCount} of {SOUND_LABELS.length} on. Nothing but your own mute and deafen feedback plays while you are deafened.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => all(true)} className="btn-ghost text-xs" data-sounds-all="1">Enable all</button>
            <button type="button" onClick={() => all(false)} className="btn-ghost text-xs" data-sounds-all="0">Disable all</button>
          </div>
        </div>
        <div>
          <div className="flex justify-between"><label className="label">Volume</label><span className="text-xs text-text-2">{prefs.volume}%</span></div>
          <input type="range" min={0} max={100} value={prefs.volume} onChange={(e) => setNotifPrefs({ volume: Number(e.target.value) })} className="w-full accent-accent" data-sound-volume />
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg-1">
          {SOUND_LABELS.map((s) => (
            <li key={s.key} className="flex items-center gap-3 px-3 py-2" data-sound-row={s.key}>
              <button type="button" onClick={() => playSfx(s.key, true)} title={`Preview ${s.label}`} aria-label={`Preview ${s.label}`} className="h-7 w-7 shrink-0 rounded-full bg-bg-3 flex items-center justify-center text-text-1 hover:text-text-0 hover:bg-bg-4" data-sfx-preview={s.key}><Play size={12} /></button>
              <div className="min-w-0 flex-1">
                <div className="text-[15px]">{s.label}</div>
                {s.hint && <div className="text-xs text-text-2 truncate">{s.hint}</div>}
              </div>
              <span data-sound-toggle={s.key} data-on={prefs.sounds[s.key] ? '1' : '0'}><Toggle checked={prefs.sounds[s.key]} onChange={(v) => setSound(s.key, v)} /></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
