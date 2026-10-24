import { getToken, setToken } from './api'
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
  write([entry, ...savedAccounts().filter((a) => a.id !== user.id)].slice(0, MAX_ACCOUNTS))
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
