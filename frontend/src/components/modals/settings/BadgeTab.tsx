import { Award, Check, Copy, Pipette, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, getToken } from '../../../lib/api'
import { BADGE_COLOR, BADGE_COLORS, BADGE_SHOW, BADGE_STYLES, badgeHtml, badgeMarkdown, expiresIn, type BadgeSettings, type BadgeShow, type BadgeStyle } from '../../../lib/invites'
import type { InviteListing } from '../../../lib/types'
import { useStore } from '../../../store'
import { Toggle } from '../SettingsShell'

/**
 * Server Settings › Badge: the server's README badge. Turn it on or off, set its label, colour, counts and default
 * style (they apply to every badge already posted), preview it with the real counts, and copy the code for an invite.
 */
export default function BadgeTab({ guildId, onInvites }: { guildId: string; onInvites: () => void }) {
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [saved, setSaved] = useState<BadgeSettings | null>(null)
  const [draft, setDraft] = useState<BadgeSettings | null>(null)
  const [invites, setInvites] = useState<InviteListing[] | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    api.get<BadgeSettings>(`/guilds/${guildId}/badge`).then((s) => { setSaved(s); setDraft(s) }).catch((e) => pushToast((e as Error).message, 'error'))
    api.get<InviteListing[]>(`/guilds/${guildId}/invites`).then(setInvites).catch(() => setInvites([]))
  }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  // The preview draws the unsaved settings with the server's real counts; it needs Manage Server, so it is fetched
  // with the session token rather than loaded as a plain image.
  useEffect(() => {
    if (!draft) return
    let url: string | null = null; let gone = false
    const t = setTimeout(async () => {
      const q = new URLSearchParams({ enabled: String(draft.enabled), label: draft.label, color: draft.color, show: draft.show, style: draft.style })
      try {
        const r = await fetch(`/api/guilds/${guildId}/badge/preview.svg?${q}`, { headers: { Authorization: `Bearer ${getToken()}` } })
        if (!r.ok || gone) return
        url = URL.createObjectURL(await r.blob()); setPreview(url)
      } catch { /* keep the last preview */ }
    }, 200)
    return () => { gone = true; clearTimeout(t); if (url) URL.revokeObjectURL(url) }
  }, [guildId, draft])
  if (!guild) return null
  const set = (p: Partial<BadgeSettings>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const dirty = !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft)
  const save = async () => {
    if (!draft) return
    setBusy(true)
    try { const s = await api.put<BadgeSettings>(`/guilds/${guildId}/badge`, draft); setSaved(s); setDraft(s); pushToast('Badge settings saved') } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const copyText = async (text: string, key: string) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500) } catch { /* ignore */ } }
  const list = invites ?? []
  // The badge's invite: the one picked, else a vanity link, else one that never expires, else the newest.
  const invite = list.find((i) => i.code === code) ?? list.find((i) => i.vanity) ?? list.find((i) => !i.expires_at && !i.max_uses) ?? list[0]
  const color = draft?.color || BADGE_COLOR
  return (
    <div className="space-y-8" data-badge-tab>
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Award size={20} /> README badge</h1>
        <p className="text-sm text-text-2 mt-1">A live badge for a GitHub README or a website that shows how many people are in {guild.name} and opens an invite when clicked. Changes here update every badge already posted.</p>
      </div>

      {!draft ? <p className="text-sm text-text-2">Loading…</p> : (
        <>
          <div className="flex items-center justify-center rounded-xl border border-line bg-bg-0/40 p-6 min-h-[5rem]">
            {preview && <img src={preview} alt={`${guild.name} badge preview`} className="max-w-full" data-badge-preview />}
          </div>

          <section className="space-y-5">
            <div data-badge-enabled>
              <Toggle label="Show the badge" checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
              <p className="text-xs text-text-2 mt-1">Off: posted badges turn grey and say "badge disabled", with no counts.</p>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-[12rem] flex-1"><label className="label">Label</label>
                <input className="input" value={draft.label} maxLength={32} placeholder="Parley" onChange={(e) => set({ label: e.target.value })} disabled={!draft.enabled} data-badge-label /></div>
              <div className="min-w-[12rem] flex-1"><label className="label">Show</label>
                <select className="input" value={draft.show} onChange={(e) => set({ show: e.target.value as BadgeShow })} disabled={!draft.enabled} data-badge-show>
                  {BADGE_SHOW.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select></div>
              <div className="min-w-[12rem] flex-1"><label className="label">Style</label>
                <select className="input" value={draft.style} onChange={(e) => set({ style: e.target.value as BadgeStyle })} disabled={!draft.enabled} data-badge-style>
                  {BADGE_STYLES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select></div>
            </div>
            <div>
              <label className="label">Colour</label>
              <div className={`flex flex-wrap items-center gap-2 ${draft.enabled ? '' : 'pointer-events-none opacity-50'}`}>
                {BADGE_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => set({ color: c === BADGE_COLOR ? '' : c })} title={c} aria-label={`Colour ${c}`} aria-pressed={color === c}
                    className={`h-8 w-8 rounded-full flex items-center justify-center ring-offset-2 ring-offset-bg-1 ${color === c ? 'ring-2 ring-text-0' : ''}`} style={{ background: c }} data-badge-color={c}>
                    {color === c && <Check size={14} className="text-white" />}
                  </button>
                ))}
                <label className={`relative overflow-hidden h-8 w-8 rounded-full flex items-center justify-center cursor-pointer border border-line ring-offset-2 ring-offset-bg-1 ${BADGE_COLORS.includes(color) ? 'bg-bg-3' : 'ring-2 ring-text-0'}`}
                  style={BADGE_COLORS.includes(color) ? undefined : { background: color }} title="Custom colour">
                  <Pipette size={14} className={BADGE_COLORS.includes(color) ? 'text-text-1' : 'text-white'} />
                  <input type="color" value={color} onChange={(e) => set({ color: e.target.value })} className="absolute inset-0 h-full w-full opacity-0 cursor-pointer" data-badge-color-custom />
                </label>
              </div>
            </div>
            <p className="text-xs text-text-2">Members set to invisible are never counted as online. Showing members only keeps who's online private.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={!dirty || busy} onClick={save} data-badge-save>Save changes</button>
              {dirty && <button type="button" className="btn-ghost" onClick={() => setDraft(saved)} data-badge-reset><RotateCcw size={16} /> Reset</button>}
            </div>
          </section>

          <section data-badge-embed>
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Add it to a README</h2>
            {invites === null ? <p className="text-sm text-text-2">Loading…</p> : !invite ? (
              <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-text-2" data-badge-no-invite>
                The badge links to an invite. <button type="button" className="text-sky-400 hover:underline" onClick={onInvites}>Create one in Invites</button>, ideally one that never expires.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[12rem] flex-1"><label className="label">Invite</label>
                    <select className="input" value={invite.code} onChange={(e) => setCode(e.target.value)} data-badge-invite>
                      {list.map((i) => <option key={i.code} value={i.code}>{i.vanity ? `/invite/${i.code}` : `${i.code} · ${i.expires_at ? `expires ${expiresIn(i)}` : 'never expires'}`}</option>)}
                    </select></div>
                  <button type="button" className="btn-primary" onClick={() => copyText(badgeMarkdown(invite.code, undefined, guild.name), 'md')} data-badge-copy="markdown">
                    {copied === 'md' ? <Check size={16} /> : <Copy size={16} />} Copy Markdown</button>
                  <button type="button" className="btn-ghost" onClick={() => copyText(badgeHtml(invite.code, undefined, guild.name), 'html')} data-badge-copy="html">
                    {copied === 'html' ? <Check size={16} /> : <Copy size={16} />} HTML</button>
                </div>
                {(invite.expires_at || invite.max_uses) && <p className="mt-2 text-xs text-warn" data-badge-warn>This invite {invite.expires_at ? `expires ${expiresIn(invite)}` : 'has a use limit'}, and the badge turns grey when it stops working. Pick one that never expires.</p>}
                <p className="mt-2 text-xs text-text-2">Add <code>?style=flat-square</code> or <code>?label=…</code> to the image link to change one badge without changing the others.</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
