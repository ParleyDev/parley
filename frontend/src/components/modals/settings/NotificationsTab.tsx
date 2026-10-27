import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toggle } from '../SettingsShell'
import { SOUND_LABELS, setNotifPrefs, setSound, useNotifPrefs, type SoundKey, type Tts } from '../../../lib/notifPrefs'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { refreshBadge } from '../../../lib/badge'
import type { NotifPrefsServer, PrivateUser } from '../../../lib/types'
import { playSfx } from '../../../lib/sfx'
import { disablePush, enablePush, pushSubscribed, pushSupported } from '../../../lib/webpush'

/** Settings → Notifications: desktop notifications and one switch per sound, Discord-style. */
export default function NotificationsTab() {
  const prefs = useNotifPrefs()
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const sp: NotifPrefsServer = user?.notif_prefs ?? {}
  const saveServer = async (patch: NotifPrefsServer) => {
    try { const u = await api.patch<PrivateUser>('/users/@me/notification-prefs', patch); if (token) setAuth(token, u) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [timeout_, setTimeout_] = useState(String(sp.push_timeout_min ?? 10))
  const [webPush, setWebPush] = useState(false)
  useEffect(() => { void pushSubscribed().then(setWebPush) }, [])
  const toggleWebPush = async (on: boolean) => {
    try {
      if (on) { const ok = await enablePush(); setWebPush(ok); if (!ok) pushToast('Notifications are blocked for this site in your browser settings.', 'error') }
      else { await disablePush(); setWebPush(false) }
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
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

      <section className="space-y-3">
        <Toggle label="Enable Unread Message Badge" checked={prefs.badge} onChange={(v) => { setNotifPrefs({ badge: v }); refreshBadge() }} />
        <p className="text-xs text-text-2">Shows the number of unread mentions, friend requests and message requests on the tab icon (and the app icon where the browser allows it).</p>
        <Toggle label="Notify me when someone replies to my message" checked={prefs.replyMentions} onChange={(v) => setNotifPrefs({ replyMentions: v })} />
        <p className="text-xs text-text-2">A reply to one of your messages counts as a mention: it pings, sounds and shows in the badge.</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2">
        <label className="label">Text-to-Speech notifications</label>
        <div className="flex flex-wrap gap-2">
          {([['never', 'Never'], ['current', 'For current selected channel'], ['all', 'For all channels']] as [Tts, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setNotifPrefs({ tts: v })} className={`rounded-md border px-3 py-1.5 text-sm ${prefs.tts === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-tts={v} data-on={prefs.tts === v ? '1' : '0'}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-text-2">Reads messages that would notify you aloud with your browser's voice. Never while deafened.</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3" data-server-notif-prefs>
        <label className="label">Push notifications</label>
        {pushSupported() && <>
          <span data-web-push-toggle><Toggle label="Push notifications on this browser" checked={webPush} onChange={(v) => void toggleWebPush(v)} /></span>
          <p className="text-xs text-text-2">Mentions and DMs reach this browser even with every Parley tab closed, with Reply and Mark as Read right on the notification.</p>
        </>}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[15px]">Push notification inactive timeout</span>
          <span className="flex items-center gap-2 text-sm"><input type="number" min={1} max={120} value={timeout_} onChange={(e) => setTimeout_(e.target.value)} onBlur={() => { const n = Math.max(1, Math.min(120, Number(timeout_) || 10)); setTimeout_(String(n)); if (n !== (sp.push_timeout_min ?? 10)) void saveServer({ push_timeout_min: n }) }} className="input w-20 py-1 text-right" data-push-timeout /> minutes</span>
        </div>
        <p className="text-xs text-text-2">While you are active in the app, phones stay quiet. After this long without activity, mentions and DMs go to your phone too.</p>
        <label className="label pt-2">Email notifications</label>
        <Toggle label="Direct messages and mentions" checked={sp.email_dms !== false} onChange={(v) => saveServer({ email_dms: v })} />
        <Toggle label="Friend requests" checked={sp.email_friend_requests !== false} onChange={(v) => saveServer({ email_friend_requests: v })} />
        <p className="text-xs text-text-2">Only while you are offline, at most one message mail an hour. Security mails (password and email changes) are always sent.</p>
        <label className="label pt-2">Defaults for servers you join</label>
        <Toggle label="Suppress @everyone and @here" checked={!!sp.default_suppress_everyone} onChange={(v) => saveServer({ default_suppress_everyone: v })} />
        <Toggle label="Suppress all role @mentions" checked={!!sp.default_suppress_roles} onChange={(v) => saveServer({ default_suppress_roles: v })} />
        <p className="text-xs text-text-2">Applied to each new server as you join; change it per server from the server menu.</p>
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
