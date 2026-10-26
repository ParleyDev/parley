import { getToken, setToken, TOKEN_KEY } from './api'
import { STORAGE_PREFIX } from './brand'

/**
 * Accounts signed in on this device for this server, so the user can hop between them without logging out.
 * Each entry keeps its session token (the same thing the active session already keeps in localStorage) plus
 * enough of the profile to draw a row. Switching swaps the active token and reloads, which resets the socket,
 * voice and every cache in one go.
 */
export type SavedAccount = { id: string; username: string; display_name: string; avatar_url: string | null; token: string }

const KEY = `${STORAGE_PREFIX}accounts`
export const MAX_ACCOUNTS = 5

export function savedAccounts(): SavedAccount[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
const write = (list: SavedAccount[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ } }

/** Upsert the signed-in account (on login and on every READY, so names and avatars stay fresh). Most recent first. */
export function rememberAccount(user: { id: string; username: string; display_name: string; avatar_url: string | null }, token: string | null) {
  if (!token) return
  const entry: SavedAccount = { id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, token }
  // A token belongs to one account, so any other entry holding it is stale (older builds could save one account under
  // another tab's token, which showed both as current and made switching do nothing); dropping it repairs the list.
  write([entry, ...savedAccounts().filter((a) => a.id !== user.id && a.token !== token)].slice(0, MAX_ACCOUNTS))
}

/** Drop the account holding this token (logged out, revoked, or removed from the switcher). */
export function forgetToken(token: string | null) {
  if (!token) return
  write(savedAccounts().filter((a) => a.token !== token))
}

export function forgetAccount(id: string) {
  write(savedAccounts().filter((a) => a.id !== id))
}

/** Make a saved account the active one and reload into it. */
export function activateAccount(acc: SavedAccount) {
  setToken(acc.token)
  location.assign('/channels/@me')
}

/** Leave the current session alive (it stays in the list) and go to the login page to add another account. */
export function startAddAccount() {
  setToken(null)
  location.assign('/login')
}

export const isActive = (acc: SavedAccount) => acc.token === getToken()

/** The account a session token belongs to (its `sub`), without verifying it: only to compare tabs. */
function tokenUser(token: string): string | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null } catch { return null }
}

/**
 * On the web every tab shares one session token (localStorage), so when another tab signs in, switches account or
 * logs out, this tab follows it. Otherwise it would keep showing one account while its requests went out as another.
 * A new token for the same account (say, after verifying an email) is just adopted.
 */
export function followOtherTabs(current: () => { token: string | null; userId: string | null }, adopt: (token: string) => void) {
  window.addEventListener('storage', (e) => {
    if (e.key !== TOKEN_KEY && e.key !== null) return
    const next = getToken()
    const { token, userId } = current()
    if (next === token) return
    if (next && userId && tokenUser(next) === userId) { adopt(next); return }
    location.assign(next ? (location.pathname.startsWith('/login') || location.pathname.startsWith('/register') ? '/channels/@me' : location.href) : '/login')
  })
}
