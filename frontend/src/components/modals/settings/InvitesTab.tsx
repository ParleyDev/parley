import { Check, Compass, Copy, Link2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import type { Listing } from '../../../lib/discover'
import { EXPIRY, expiresIn, MAX_VANITY, USES, VANITY_RE } from '../../../lib/invites'
import type { Invite, InviteListing } from '../../../lib/types'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'
import { publicOrigin } from '../../InviteCard'

/**
 * Server Settings › Invites: every live invite with who made it, uses and expiry, to revoke; a quick form to make one
 * with an expiry and use limit; and, for servers approved for Discovery, up to three vanity links.
 */
export default function InvitesTab({ guildId, onDiscovery }: { guildId: string; onDiscovery: () => void }) {
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<InviteListing[] | null>(null)
  const [approved, setApproved] = useState<boolean | null>(null)
  const [maxAge, setMaxAge] = useState(7 * 86400)
  const [maxUses, setMaxUses] = useState(0)
  const [vanity, setVanity] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [, tick] = useState(0)
  const load = () => api.get<InviteListing[]>(`/guilds/${guildId}/invites`).then(setList).catch((e) => { setList([]); pushToast((e as Error).message, 'error') })
  useEffect(() => {
    load()
    api.get<Listing | null>(`/guilds/${guildId}/discovery`).then((l) => setApproved(l?.status === 'approved')).catch(() => setApproved(false))
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!guild) return null
  const me = useStore.getState().user
  const withCreator = (i: Invite): InviteListing => ({ ...i, creator_username: me?.username ?? '', creator_display_name: me?.display_name ?? '', creator_avatar_url: me?.avatar_url ?? null })
  const link = (code: string) => `${publicOrigin()}/invite/${code}`
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(link(code)); setCopied(code); setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500) } catch { /* ignore */ } }
  const create = async (body: Record<string, unknown>) => {
    setBusy(true)
    try { const inv = await api.post<Invite>(`/guilds/${guildId}/invites`, body); setList((l) => [withCreator(inv), ...(l ?? [])]); return inv } catch (e) { pushToast((e as Error).message, 'error'); return null } finally { setBusy(false) }
  }
  const addVanity = async (e: FormEvent) => { e.preventDefault(); if (await create({ vanity })) setVanity('') }
  // Revoking is instant, as in Discord; a vanity link asks once inline (another server could claim it). A confirm modal
  // would replace these settings, since only one modal is open at a time.
  const [confirming, setConfirming] = useState<string | null>(null)
  const revoke = async (inv: InviteListing) => {
    if (inv.vanity && confirming !== inv.code) { setConfirming(inv.code); return }
    setConfirming(null)
    try { await api.delete(`/guilds/${guildId}/invites/${encodeURIComponent(inv.code)}`); setList((l) => (l ?? []).filter((x) => x.code !== inv.code)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const vanities = (list ?? []).filter((i) => i.vanity)
  const regular = (list ?? []).filter((i) => !i.vanity)
  const vanityOk = VANITY_RE.test(vanity)
  const copyBtn = (code: string) => (
    <button type="button" onClick={() => copy(code)} className="rounded p-1.5 text-text-2 hover:bg-bg-3 hover:text-text-0" title="Copy link" data-invite-copy={code}>{copied === code ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
  )
  return (
    <div className="space-y-8" data-invites-tab>
      <div>
        <h1 className="text-xl font-bold">Invites</h1>
        <p className="text-sm text-text-2 mt-1">Links people can use to join {guild.name}. Revoking one stops it working straight away; people who already joined stay.</p>
      </div>

      <section data-vanity-section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2 flex items-center gap-1.5"><Sparkles size={14} /> Vanity links</h2>
        {approved === null ? <p className="text-sm text-text-2">Loading…</p> : !approved ? (
          <div className="rounded-xl bg-bg-0/50 border border-line p-4 flex items-start gap-3" data-vanity-locked>
            <Compass size={20} className="text-text-2 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p>Servers approved for Discovery can claim up to {MAX_VANITY} custom links, like <span className="font-medium">{publicOrigin().replace(/^https?:\/\//, '')}/invite/your-name</span>.</p>
              <button type="button" className="mt-2 text-sky-400 hover:underline" onClick={onDiscovery}>Go to Discovery</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {vanities.map((v) => (
              <div key={v.code} className="flex items-center gap-2 rounded-lg border border-line bg-bg-0/40 pl-3 pr-1 py-1" data-vanity={v.code}>
                <Link2 size={16} className="text-text-2 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm"><span className="text-text-2">{publicOrigin().replace(/^https?:\/\//, '')}/invite/</span><b>{v.code}</b></span>
                <span className="text-xs text-text-2 max-sm:hidden">{v.uses} {v.uses === 1 ? 'use' : 'uses'}</span>
                {copyBtn(v.code)}
                {confirming === v.code
                  ? <button type="button" onClick={() => revoke(v)} onBlur={() => setConfirming(null)} autoFocus className="rounded bg-danger px-2 py-1 text-xs font-semibold text-white hover:bg-danger/80" data-vanity-remove-confirm={v.code}>Remove?</button>
                  : <button type="button" onClick={() => revoke(v)} className="rounded p-1.5 text-text-2 hover:bg-bg-3 hover:text-danger" title="Remove" data-vanity-remove={v.code}><X size={16} /></button>}
              </div>
            ))}
            {vanities.length < MAX_VANITY ? (
              <form onSubmit={addVanity} className="flex items-center gap-2">
                <div className="flex flex-1 min-w-0 items-center rounded-lg border border-line bg-bg-0/60 pl-3 focus-within:border-accent">
                  <span className="text-sm text-text-2 shrink-0 max-sm:hidden">/invite/</span>
                  <input className="min-w-0 flex-1 bg-transparent py-2 pr-3 text-sm outline-none" value={vanity} maxLength={32} placeholder="your-name"
                    onChange={(e) => setVanity(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} data-vanity-input />
                </div>
                <button className="btn-primary shrink-0" disabled={busy || !vanityOk} data-vanity-add><Plus size={16} /> Add</button>
              </form>
            ) : <p className="text-xs text-text-2">You're using all {MAX_VANITY} vanity links. Remove one to claim another.</p>}
            <p className="text-xs text-text-2">3–32 lowercase letters, numbers or hyphens. Vanity links never expire and stop working if the server leaves Discovery. {vanities.length}/{MAX_VANITY} used.</p>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Create an invite</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1"><label className="label">Expire after</label>
            <select className="input" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} data-new-invite-expiry>{EXPIRY.map((o) => <option key={o.s} value={o.s}>{o.label}</option>)}</select></div>
          <div className="min-w-[9rem] flex-1"><label className="label">Max number of uses</label>
            <select className="input" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} data-new-invite-uses>{USES.map((o) => <option key={o.n} value={o.n}>{o.label}</option>)}</select></div>
          <button type="button" className="btn-primary" disabled={busy} onClick={async () => { const inv = await create({ max_age: maxAge, max_uses: maxUses }); if (inv) copy(inv.code) }} data-new-invite>Create and copy</button>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Active invites{list ? ` (${regular.length})` : ''}</h2>
        {list === null ? <p className="text-sm text-text-2">Loading…</p> : regular.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">No active invites. Make one above, or with Invite People.</div>
        ) : (
          <div className="rounded-lg border border-line divide-y divide-line" data-invite-list>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_6.5rem_4.5rem] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 max-sm:hidden">
              <span>Inviter</span><span>Code</span><span>Uses</span><span>Expires</span><span />
            </div>
            {regular.map((i) => (
              <div key={i.code} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_6.5rem_4.5rem] max-sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm" data-invite-row={i.code}>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar user={{ id: i.creator_id, display_name: i.creator_display_name, avatar_url: i.creator_avatar_url }} size={24} />
                  <span className="truncate">{i.creator_display_name}</span>
                </div>
                <span className="truncate font-mono text-text-1 max-sm:hidden">{i.code}</span>
                <span className="text-text-1 max-sm:hidden" data-invite-uses-cell>{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ''}</span>
                <span className="text-text-1 max-sm:hidden" data-invite-expires>{expiresIn(i)}</span>
                <div className="flex justify-end">
                  {copyBtn(i.code)}
                  <button type="button" onClick={() => revoke(i)} className="rounded p-1.5 text-text-2 hover:bg-bg-3 hover:text-danger" title="Revoke" data-invite-revoke={i.code}><X size={16} /></button>
                </div>
                <div className="col-span-2 -mt-1 text-xs text-text-2 sm:hidden"><span className="font-mono">{i.code}</span> · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} uses · {i.expires_at ? `expires ${expiresIn(i)}` : 'never expires'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
