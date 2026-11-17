import { getToken } from './api'
import { download } from './fileActions'
import { t } from './i18n'
import { publicOrigin } from '../components/InviteCard'

/**
 * Server templates as files and links (backend routes/templates.rs). A file is `{ "parley_template": 1, name,
 * description, exported_at, snapshot }`; the server reads those, Discord's template JSON, and links or codes.
 */

/** Download a template file from `path` (an API path such as `/guilds/ID/template/export`). */
export async function downloadTemplate(path: string, fallbackName: string) {
  const token = getToken()
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText)
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${fallbackName}.parley-template.json`
  const url = URL.createObjectURL(await res.blob())
  try { await download(url, name) } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}

/** A `…/template/CODE` link to another Parley server: its address and the code. Null for this server, Discord, codes. */
export function foreignTemplateLink(input: string): { origin: string; code: string } | null {
  let u: URL
  try { u = new URL(input.trim()) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || /(^|\.)discord(app)?\.(com|new)$/i.test(u.hostname)) return null
  const m = /\/template\/([A-Za-z0-9]{4,64})\/?$/.exec(u.pathname)
  if (!m || u.origin === location.origin || u.origin === publicOrigin()) return null
  return { origin: u.origin, code: m[1] }
}

/**
 * What to send the server for `input`: a link to a template on another Parley server is read here (its file is
 * public), so this server never fetches addresses people type; anything else goes as it is.
 */
export async function templateSource(input: string): Promise<string> {
  const far = foreignTemplateLink(input)
  if (!far) return input
  try {
    const res = await fetch(`${far.origin}/api/templates/${far.code}/export`)
    if (res.status === 404) throw new Error(t('{host} has no template with that link.', { host: new URL(far.origin).host }))
    if (!res.ok) throw new Error(String(res.status))
    return await res.text()
  } catch (e) {
    if ((e as Error).message.includes(new URL(far.origin).host)) throw e
    throw new Error(t("Couldn't read the template from {host}. Open the link there, download the template file and choose it here.", { host: new URL(far.origin).host }))
  }
}
