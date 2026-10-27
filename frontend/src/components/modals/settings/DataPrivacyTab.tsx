import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import { Toggle } from '../SettingsShell'
import DataSection from './DataSection'
import { usePrefs } from '../../../lib/prefs'
import { untrustHost } from '../../../lib/links'
import { APP_NAME } from '../../../lib/brand'
import { useT } from '../../../lib/i18n'

/** Settings → Data & Privacy: what others can tell about you, what this server keeps, and your data export. */
export default function DataPrivacyTab() {
  const t = useT()
  const user = useStore((s) => s.user)
  const prefs = usePrefs()
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  if (!user) return null
  const save = async (patch: Partial<Pick<PrivateUser, 'show_read_receipts' | 'show_typing' | 'share_activity'>>) => {
    try { const u = await api.patch<PrivateUser>('/users/@me/privacy', patch); if (token) setAuth(token, u) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="space-y-6" data-privacy-tab>
      <h2 className="text-xl font-bold">{t('Data & Privacy')}</h2>

      <section className="space-y-3">
        <h3 className="label">{t('Privacy controls')}</h3>
        <span data-privacy-receipts><Toggle label={t('Show that I have read direct messages')} checked={user.show_read_receipts !== false} onChange={(v) => save({ show_read_receipts: v })} /></span>
        <p className="text-xs text-text-2">{t('Off: nobody sees a "Seen" marker on messages you read. You will still see theirs if they allow it.')}</p>
        <span data-privacy-typing><Toggle label={t('Show when I am typing')} checked={user.show_typing !== false} onChange={(v) => save({ show_typing: v })} /></span>
        <span data-privacy-activity><Toggle label={t('Share my activity status')} checked={user.share_activity !== false} onChange={(v) => save({ share_activity: v })} /></span>
        <p className="text-xs text-text-2">{t('Shows what you are listening to on Spotify, or the activity you set yourself, next to your name. Off: nobody sees either.')}</p>
        <p className="text-xs text-text-2">{t('Off: the "… is typing" line never shows for you. Your online status is controlled from the status picker (choose Invisible to appear offline).')}</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2" data-trusted-hosts>
        <h3 className="label">{t('Trusted link destinations')}</h3>
        <p className="text-xs text-text-2">{t('Sites you chose "don\'t ask again" for in the Leaving {app} warning. Links to any other site always show the warning with the real address.', { app: APP_NAME })}</p>
        {prefs.trustedHosts.length === 0 && <p className="text-sm text-text-2">{t('None yet.')}</p>}
        <ul className="flex flex-wrap gap-2">{prefs.trustedHosts.map((h) => <li key={h} className="flex items-center gap-1 rounded-full bg-bg-3 pl-3 pr-1 py-0.5 text-sm" data-trusted-host={h}>{h}<button type="button" onClick={() => untrustHost(h)} className="h-6 w-6 rounded-full hover:bg-bg-4 text-text-2" title={t('Forget')}>×</button></li>)}</ul>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2">
        <h3 className="label">{t('How this server uses your data')}</h3>
        <ul className="text-sm text-text-1 space-y-1 list-disc pl-5">
          <li>{t('No analytics, advertising or tracking: nothing about your use of the app is sent to third parties.')}</li>
          <li>{t('Messages, uploads and settings stay on this server so it can show them to you and the people you share them with.')}</li>
          <li>{t('Logins keep the IP address and browser of each device (see Devices) so you can spot one you do not recognise.')}</li>
          <li>{t('Email is used for verification, password resets, security notices and the notifications you turn on.')}</li>
        </ul>
      </section>

      <div className="h-px bg-line" />

      <DataSection />
    </div>
  )
}
