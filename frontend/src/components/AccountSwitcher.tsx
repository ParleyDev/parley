import { Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { activateAccount, forgetAccount, isActive, MAX_ACCOUNTS, savedAccounts, startAddAccount, type SavedAccount } from '../lib/accounts'
import { unregisterPush } from '../lib/native'
import Avatar from './Avatar'
import { useT } from '../lib/i18n'

/**
 * Accounts remembered on this device: tap one to switch to it, × to forget it here (its session is left alone),
 * and "Add an account" to sign in another without logging this one out. `signedIn` is false on the login page,
 * where there is no current session to hand off.
 */
export default function AccountSwitcher({ signedIn = true }: { signedIn?: boolean }) {
  const [list, setList] = useState(savedAccounts)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const shown = signedIn ? list : list.filter((a) => !isActive(a))
  // This device's push token is tied to the account that registered it; hand it over before leaving.
  const leave = async (fn: () => void) => { setBusy(true); if (signedIn) await unregisterPush(); fn() }
  const pick = (a: SavedAccount) => { if (!isActive(a)) void leave(() => activateAccount(a)) }
  const forget = (a: SavedAccount) => { forgetAccount(a.id); setList(savedAccounts()) }

  if (!signedIn && !shown.length) return null
  return (
    <div data-account-switcher>
      {shown.map((a) => (
        <div key={a.id} className="group flex items-center rounded-md hover:bg-bg-3" data-account-row={a.username}>
          <button type="button" disabled={busy} onClick={() => pick(a)} className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-left" title={isActive(a) ? t('Current account') : t('Switch to @{name}', { name: a.username })}>
            <Avatar user={a} size={24} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm text-text-0">{a.display_name || a.username}</span><span className="block truncate text-xs text-text-2">@{a.username}</span></span>
            {isActive(a) && <Check size={14} className="text-success shrink-0" />}
          </button>
          {!isActive(a) && <button type="button" onClick={() => forget(a)} className="mr-1 h-6 w-6 shrink-0 rounded flex items-center justify-center text-text-2 hover:text-danger opacity-60 group-hover:opacity-100" title={t('Remove from this device')} data-account-forget><X size={14} /></button>}
        </div>
      ))}
      {signedIn && list.length < MAX_ACCOUNTS && (
        <button type="button" disabled={busy} onClick={() => void leave(startAddAccount)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white" data-account-add>
          <span className="h-6 w-6 rounded-full bg-bg-3 flex items-center justify-center"><Plus size={14} /></span>{t('Add an account')}
        </button>
      )}
    </div>
  )
}
