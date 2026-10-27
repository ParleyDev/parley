import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { APP_NAME } from '../lib/brand'
import { t, useT } from '../lib/i18n'

interface Op { tags: string[]; summary: string; 'x-auth': string }
interface Spec { info: { title: string; description: string }; servers: { url: string }[]; paths: Record<string, Record<string, Op>>; components: { securitySchemes: { oauth2: { flows: { authorizationCode: { scopes: Record<string, string> } } } } } }

const METHOD: Record<string, string> = { get: 'bg-sky-600', post: 'bg-success text-black', put: 'bg-warn text-black', patch: 'bg-accent', delete: 'bg-danger' }
const authLabels = (): Record<string, string> => ({ user: t('User session'), bot: t('Bot token'), none: t('No auth'), 'token in URL': t('Token in the URL') })

/** /developers: the API reference (from /api/openapi.json) and the basics of building a bot. Public. */
export default function DevelopersPage() {
  const t = useT()
  const [spec, setSpec] = useState<Spec | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { fetch('/api/v1/openapi.json').then((r) => r.json()).then(setSpec).catch(() => setSpec(null)) }, [])
  const groups = useMemo(() => {
    const out: Record<string, { method: string; path: string; op: Op }[]> = {}
    for (const [path, ops] of Object.entries(spec?.paths ?? {})) for (const [method, op] of Object.entries(ops)) {
      if (q && !`${method} ${path} ${op.summary}`.toLowerCase().includes(q.toLowerCase())) continue
      ;(out[op.tags[0]] ??= []).push({ method, path, op })
    }
    return out
  }, [spec, q])
  const base = spec?.servers[0]?.url ?? '/api/v1'
  return (
    <div className="h-full overflow-y-auto bg-bg-0 text-text-0" data-developers>
      <div className="mx-auto max-w-4xl space-y-8 p-6 max-md:p-3">
        <header><h1 className="text-3xl font-bold">{t('{app} for developers', { app: APP_NAME })}</h1><p className="mt-2 text-text-2">{t('Build bots and apps: OAuth2, a REST API at {base}, a gateway for events, commands and interactions.', { base })}</p></header>
        <section className="grid grid-cols-2 gap-3 max-md:grid-cols-1 text-sm" data-dev-guide>
          {[
            [t('Get started'), t('Create an app in User Settings › Applications, add a bot, and copy its token. Invite it with the link generator there, choosing its permissions.')],
            [t('Authentication'), t('Bots send Authorization: Bot <token>. Apps send Authorization: Bearer <access token> from the OAuth2 code (or client_credentials) grant.')],
            [t('Gateway'), t('Connect a WebSocket to /ws?token=<bot token>&intents=<bits>. Server members (1<<1), presences (1<<8) and message content (1<<15) are privileged: switch them on for the app first.')],
            [t('Commands'), t('PUT your commands to /applications/{app_id}/commands. Uses arrive as INTERACTION_CREATE on the gateway; answer within 3 seconds at /interactions/{id}/{token}/callback.', { app_id: '{app_id}', id: '{id}', token: '{token}' })],
            [t('Rate limits'), t('Every limited response has X-RateLimit-Bucket, -Limit, -Remaining and -Reset-After. A 429 says how long to wait in Retry-After.')],
            [t('Versioning'), t('{base} is the stable, versioned prefix. Breaking changes will come as a new version; /api stays an alias of v1.', { base })],
          ].map(([title, d]) => <div key={title} className="rounded-xl border border-line bg-bg-1 p-4"><h2 className="mb-1 font-semibold">{title}</h2><p className="text-text-1">{d}</p></div>)}
        </section>
        <section className="space-y-3">
          <div className="flex items-center gap-3"><h2 className="text-xl font-bold">{t('API reference')}</h2><a href={`${base}/openapi.json`} className="text-sm text-sky-400 hover:underline">openapi.json</a></div>
          <div className="relative"><input className="input pl-9" placeholder={t('Search endpoints')} value={q} onChange={(e) => setQ(e.target.value)} data-dev-search /><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" /></div>
          {!spec ? <p className="text-sm text-text-2">{t('Loading…')}</p> : Object.entries(groups).map(([tag, list]) => (
            <div key={tag} data-dev-group={tag}>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2">{tag}</h3>
              <div className="divide-y divide-line rounded-xl border border-line bg-bg-1">
                {list.map(({ method, path, op }) => (
                  <div key={method + path} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-dev-endpoint={`${method.toUpperCase()} ${path}`}>
                    <span className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold uppercase text-white ${METHOD[method]}`}>{method}</span>
                    <code className="font-mono text-[13px]">{path}</code>
                    <span className="min-w-0 flex-1 text-text-1">{op.summary}</span>
                    <span className="flex flex-wrap gap-1">{op['x-auth'].split('|').map((a) => <span key={a} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px] text-text-1">{authLabels()[a] ?? a.replace('scope:', 'scope ')}</span>)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
        {spec && <section><h2 className="mb-2 text-xl font-bold">{t('OAuth2 scopes')}</h2><div className="divide-y divide-line rounded-xl border border-line bg-bg-1 text-sm">{Object.entries(spec.components.securitySchemes.oauth2.flows.authorizationCode.scopes).map(([k, v]) => <div key={k} className="flex gap-3 px-3 py-2"><code className="w-48 shrink-0 font-mono">{k}</code><span className="text-text-1">{v}</span></div>)}</div></section>}
      </div>
    </div>
  )
}
