import SessionsSection from './SessionsSection'
import { useT } from '../../../lib/i18n'

/** Settings → Devices: every active login with its platform, the current one highlighted. */
export default function DevicesTab() {
  const t = useT()
  return (
    <div className="space-y-6" data-devices-tab>
      <h2 className="text-xl font-bold">{t('Devices')}</h2>
      <p className="text-sm text-text-2">{t("Here are all the devices currently logged in with your account. You can log out of any device you don't recognise, or all of them at once. If you see a device you don't know, change your password straight away.")}</p>
      <SessionsSection />
    </div>
  )
}
