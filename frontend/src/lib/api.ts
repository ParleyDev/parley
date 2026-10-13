export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  try { return localStorage.getItem('y99.token') } catch { return null }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem('y99.token', t) : localStorage.removeItem('y99.token') } catch { /* ignore */ }
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
  delete: <T>(p: string) => request<T>('DELETE', p),
}
