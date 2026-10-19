import { STORAGE_PREFIX } from './brand'
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TOKEN_KEY = `${STORAGE_PREFIX}token`

export function getToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) return t
    // One-time migration from the pre-rename key.
    const old = localStorage.getItem('y99.token')
    if (old) { localStorage.setItem(TOKEN_KEY, old); localStorage.removeItem('y99.token') }
    return old
  } catch { return null }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? res.statusText ?? 'Request failed'
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  delete: <T>(p: string, body?: unknown) => request<T>('DELETE', p, body),
  /** GET that also returns response headers (for X-Total-Count style paging). */
  getWithHeaders: async <T>(p: string): Promise<{ data: T; headers: Headers }> => {
    const token = getToken()
    const res = await fetch(`/api${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const text = await res.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText)
    return { data: data as T, headers: res.headers }
  },
}
