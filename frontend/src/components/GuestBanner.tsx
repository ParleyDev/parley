import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** Top-of-app notice for "Try Parley" guests: what happens to the account, and a way to keep it. */
export default function GuestBanner() {
  const t = useT()
  const guest = useStore((s) => s.user?.guest)
  const openModal = useStore((s) => s.openModal)
  if (!guest) return null
  return (
    <div className="shrink-0 bg-accent/15 border-b border-accent/40 text-xs px-3 py-1.5 flex items-center justify-center gap-3 text-text-0" data-guest-banner>
      <span>{t("You're trying Parley as a guest.")}<span className="phone:hidden"> {t('This account is removed an hour after you leave.')}</span></span>
      <button type="button" onClick={() => openModal({ kind: 'claimGuest' })} className="font-semibold underline" data-guest-claim>{t('Sign up to keep it')}</button>
    </div>
  )
}
