import SessionsSection from './SessionsSection'

/** Settings → Devices: every active login with its platform, the current one highlighted. */
export default function DevicesTab() {
  return (
    <div className="space-y-6" data-devices-tab>
      <h2 className="text-xl font-bold">Devices</h2>
      <p className="text-sm text-text-2">Here are all the devices currently logged in with your account. You can log out of any device you don't recognise, or all of them at once. If you see a device you don't know, change your password straight away.</p>
      <SessionsSection />
    </div>
  )
}
