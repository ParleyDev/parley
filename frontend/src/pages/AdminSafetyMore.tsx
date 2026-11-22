import { CheckCircle2, CircleAlert, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { type Policies, refreshPolicies } from '../lib/policies'
import { useStore } from '../store'

interface ExplicitConfig { service_url: string; service_token_set: boolean; allow_when_down: boolean; active: boolean }

/**
 * Admin › Explicit Image Checks: a classifier service the server asks, so the explicit image filter no longer
 * depends on each member's app. Off until an address is set. Parley ships no model.
 */
export function ExplicitPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [cfg, setCfg] = useState<ExplicitConfig | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [allow, setAllow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
  const take = (c: ExplicitConfig) => { setCfg(c); setUrl(c.service_url); setAllow(c.allow_when_down); setToken('') }
  useEffect(() => { api.get<ExplicitConfig>('/admin/safety/explicit').then(take).catch((e) => pushToast((e as Error).message, 'error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  if (!cfg) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const dirty = url !== cfg.service_url || allow !== cfg.allow_when_down || !!token
  const save = (extra: Record<string, unknown> = {}) => run(async () => { take(await api.put<ExplicitConfig>('/admin/safety/explicit', { service_url: url, allow_when_down: allow, ...(token ? { service_token: token } : {}), ...extra })); setProbe(null); pushToast(t('Saved')) })
  return (
    <div className="max-w-2xl space-y-6" data-admin-explicit data-explicit-active={cfg.active ? '1' : '0'}>
      <div>
        <h1 className="text-xl font-bold">{t('Explicit image checks')}</h1>
        <p className="mt-1 text-sm text-text-2">{t("Without this, explicit pictures are only caught by each member's own app, so a bot or a changed app is never checked, and profile pictures, banners, server icons, emoji and stickers are not checked at all. With a classifier service connected, the server checks them itself: pictures everyone sees are always refused when explicit, and attachments are refused where a server's explicit image filter applies. Channels marked 18+ are left alone.")}</p>
      </div>
      <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${cfg.active ? 'border-success/40 bg-success/10' : 'border-warn/40 bg-warn/10'}`} data-explicit-state>
        {cfg.active ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : <CircleAlert size={18} className="mt-0.5 shrink-0 text-warn" />}
        <div><div className="font-semibold">{cfg.active ? t('The server checks pictures') : t('Off: the server checks no pictures')}</div>
          <div className="text-text-2">{t('Parley does not include a classifier. You run a small service that answers whether a picture is explicit; see docs/self-hosting/explicit-images.md for the contract and an example.')}</div></div>
      </div>
      <section className="space-y-3 rounded-xl border border-line p-4">
        <label className="block"><span className="label">{t('Service address')}</span><input className="input w-full" placeholder="https://classifier.example.internal/check" value={url} onChange={(e) => setUrl(e.target.value)} data-explicit-url /></label>
        <label className="block"><span className="label">{t('Access token')}</span>
          <span className="flex gap-2">
            <input className="input flex-1" type="password" autoComplete="off" placeholder={cfg.service_token_set ? t('A token is set. Type a new one to replace it.') : t('Optional: sent to the service with every picture')} value={token} onChange={(e) => setToken(e.target.value)} data-explicit-token />
            {cfg.service_token_set && <button type="button" className="btn-ghost" disabled={busy} onClick={() => save({ service_token: '' })}>{t('Remove')}</button>}
          </span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={allow} onChange={(e) => setAllow(e.target.checked)} data-explicit-allow-down />
          <span><span className="font-semibold">{t('Let profile pictures and the like through when the service cannot be reached')}</span><span className="block text-text-2">{t('Off (recommended): while the service is down, new profile pictures, banners, icons, emoji and stickers are refused, because everyone sees them. Attachments always go through while it is down.')}</span></span></label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => save()} data-explicit-save>{t('Save')}</button>
          <button type="button" className="btn-ghost" disabled={busy || !cfg.service_url || dirty} title={dirty ? t('Save first') : undefined} data-explicit-test onClick={() => run(async () => setProbe(await api.post<{ ok: boolean; message: string }>('/admin/safety/explicit/test')))}>{t('Send a test picture')}</button>
          {probe && <span className={`text-sm ${probe.ok ? 'text-success' : 'text-danger'}`} data-explicit-probe={probe.ok ? 'ok' : 'failed'}>{probe.message}</span>}
        </div>
      </section>
    </div>
  )
}

interface Feed { id: string; name: string; url: string; enabled: boolean; entries: number; last_run: string | null; last_status: string }
interface Feeds { feeds: Feed[]; manual: number; total: number; refresh_hours: number }
/** Lists known to work with the accepted formats. The operator can add any other. */
const SUGGESTED: { name: string; url: string }[] = [{ name: 'URLhaus (abuse.ch)', url: 'https://urlhaus.abuse.ch/downloads/hostfile/' }]

/** Admin › Blocked Links: lists of malicious domains kept up by others, fetched every few hours. */
export function LinkFeeds() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<Feeds | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Feeds>('/admin/link-feeds').then(setData).catch(() => setData(null)) }, [])
  if (!data) return null
  const run = async (f: () => Promise<Feeds>) => { setBusy(true); try { setData(await f()) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const add = (n: string, u: string) => run(async () => { const d = await api.post<Feeds>('/admin/link-feeds', { name: n, url: u }); setName(''); setUrl(''); return d })
  const offered = SUGGESTED.filter((s) => !data.feeds.some((f) => f.url === s.url))
  return (
    <section className="mt-8 max-w-2xl space-y-3 rounded-xl border border-line p-4" data-link-feeds={data.feeds.length} data-link-total={data.total}>
      <div>
        <h2 className="font-bold">{t('Threat feeds')}</h2>
        <p className="text-sm text-text-2">{t('Lists of malicious domains that others keep up to date. Parley fetches each one every {hours} hours and blocks links to the domains it names, in messages and in link previews, next to the ones you added by hand. A feed never removes or overrides your own entries.', { hours: data.refresh_hours })}</p>
        <p className="mt-1 text-xs text-text-2">{t('{total} domains blocked: {manual} added by hand, the rest from feeds.', { total: data.total.toLocaleString(), manual: data.manual.toLocaleString() })}</p>
      </div>
      {data.feeds.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {data.feeds.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-link-feed={f.name} data-feed-status={f.last_status === 'ok' ? 'ok' : f.last_run ? 'failed' : 'new'}>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={f.enabled} disabled={busy} onChange={(e) => run(() => api.patch<Feeds>(`/admin/link-feeds/${f.id}`, { enabled: e.target.checked }))} data-feed-enabled /><span className="font-semibold">{f.name}</span></label>
              <span className="min-w-0 flex-1 truncate text-xs text-text-2">{f.url}</span>
              <span className="text-xs text-text-2" data-feed-entries>{t('{n} domains', { n: f.entries.toLocaleString() })}</span>
              <span className={`w-full text-xs ${f.last_status === 'ok' || !f.last_run ? 'text-text-2' : 'text-danger'}`}>{!f.last_run ? t('Not fetched yet') : f.last_status === 'ok' ? t('Fetched {when}', { when: formatTime(f.last_run) }) : t('Last try failed ({when}): {why}. What it listed before is still blocked.', { when: formatTime(f.last_run), why: f.last_status })}</span>
              <button type="button" className="text-text-2 hover:text-text-0" disabled={busy} title={t('Fetch now')} aria-label={t('Fetch now')} onClick={() => run(() => api.post<Feeds>(`/admin/link-feeds/${f.id}/refresh`))} data-feed-refresh><RefreshCw size={15} /></button>
              <button type="button" className="text-text-2 hover:text-danger" disabled={busy} title={t('Remove this feed')} aria-label={t('Remove this feed')} onClick={() => run(() => api.delete<Feeds>(`/admin/link-feeds/${f.id}`))} data-feed-remove><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {offered.map((s) => <button key={s.url} type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => add(s.name, s.url)} data-feed-suggested>{t('Add {name}', { name: s.name })}</button>)}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input className="input" placeholder={t('Name')} value={name} onChange={(e) => setName(e.target.value)} data-feed-name />
        <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} data-feed-url />
        <button type="button" className="btn-primary" disabled={busy || !name.trim() || !url.trim()} onClick={() => add(name, url)} data-feed-add>{t('Add feed')}</button>
      </div>
      <p className="text-xs text-text-2">{t('A feed is a plain text list: one domain per line, or a hosts file. Lines that name a single page of a site are skipped, and a short list of sites everybody shares is never blocked.')}</p>
    </section>
  )
}

/** Admin › Policies & Contacts: where this instance's own documents are and how to reach its operator. */
export function PoliciesPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [saved, setSaved] = useState<Policies | null>(null)
  const [p, setP] = useState<Policies | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Policies>('/admin/policies').then((x) => { setSaved(x); setP(x) }).catch((e) => pushToast((e as Error).message, 'error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || !saved) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const field = (k: keyof Policies, label: string, hint: string, ph: string) => (
    <label className="block"><span className="label">{label}</span><input className="input w-full" placeholder={ph} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} data-policy-field={k} /><span className="mt-0.5 block text-xs text-text-2">{hint}</span></label>
  )
  const save = async () => { setBusy(true); try { const x = await api.put<Policies>('/admin/policies', p); setSaved(x); setP(x); refreshPolicies(); pushToast(t('Saved')) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  return (
    <div className="max-w-2xl space-y-6" data-admin-policies>
      <div>
        <h1 className="text-xl font-bold">{t('Policies & contacts')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Running an instance makes you the provider of the service. These are your documents and your addresses: Parley shows them at sign-up, on reports and in account settings, and ships templates you can start from in docs/policies. Leave a field empty and it is not shown.')}</p>
      </div>
      <section className="space-y-3 rounded-xl border border-line p-4">
        <h2 className="font-bold">{t('Documents')}</h2>
        {field('terms_url', t('Terms'), t('What people agree to when they create an account.'), 'https://example.org/terms')}
        {field('guidelines_url', t('Community guidelines'), t('What is not allowed here, in plain words.'), 'https://example.org/guidelines')}
        {field('privacy_url', t('Privacy notice'), t('What you keep about people and for how long.'), 'https://example.org/privacy')}
      </section>
      <section className="space-y-3 rounded-xl border border-line p-4">
        <h2 className="font-bold">{t('Contacts')}</h2>
        {field('safety_contact', t('Safety contact'), t('An email address or a web page. Shown to members on reports and in My Account.'), 'safety@example.org')}
        {field('legal_contact', t('Lawful requests and takedown notices'), t('Where the police, courts and rights holders should write. Published at /api/instance/policies for them to find.'), 'legal@example.org')}
      </section>
      <button type="button" className="btn-primary" disabled={busy || JSON.stringify(p) === JSON.stringify(saved)} onClick={save} data-policy-save>{t('Save')}</button>
    </div>
  )
}
