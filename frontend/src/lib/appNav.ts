/** In-app navigation for code outside the router (message links), set by the app shell. Null before it mounts. */
let navigate: ((path: string) => void) | null = null
export const setAppNavigator = (fn: ((path: string) => void) | null) => { navigate = fn }

/**
 * A link to this app's own admin console (event notifications post them) as an in-app path, else null. Other
 * same-site links keep opening in a new tab as before.
 */
export function inAppPath(href: string, origin = typeof location === 'undefined' ? '' : location.origin): string | null {
  try {
    const u = new URL(href)
    if (!origin || u.origin !== origin || !/^\/admin(\/|$)/.test(u.pathname)) return null
    return u.pathname + u.search + u.hash
  } catch { return null }
}

/** Go there in the app; false when no navigator is set (the caller lets the browser follow the link). */
export function goInApp(path: string): boolean { if (!navigate) return false; navigate(path); return true }
