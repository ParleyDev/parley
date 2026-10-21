import { Camera, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { DECORATIONS, type PanelItem, type PrivateUser } from '../../../lib/types'
import { EFFECTS, FONTS, nameLook, type NameEffect, type NameFont, type NameStyle } from '../../../lib/nameStyle'
import NameStyleModal from '../NameStyle'
import { colorFor } from '../../../lib/format'
import { prepareImage, uploadImage } from '../../../lib/upload'
import ImagePicker from '../ImagePicker'
import ProfileCard from '../../ProfileCard'
import Avatar from '../../Avatar'
import { Toggle } from '../SettingsShell'
import { ROLE_COLORS } from '../../../lib/perms'

const MAX_BIO = 400

/** Everything about how your profile card looks, with a live preview. */
export default function ProfilesTab() {
  const user = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const pushToast = useStore((s) => s.pushToast)
  const [display, setDisplay] = useState(user?.display_name ?? '')
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatar, setAvatar] = useState<string | null>(user?.avatar_url ?? null)
  const [banner, setBanner] = useState<string | null>(user?.banner_url ?? null)
  const [primary, setPrimary] = useState<string | null>(user?.theme_primary ?? null)
  const [accent, setAccent] = useState<string | null>(user?.theme_accent ?? null)
  const [namePrimary, setNamePrimary] = useState<string | null>(user?.name_primary ?? null)
  const [nameAccent, setNameAccent] = useState<string | null>(user?.name_accent ?? null)
  const [decoration, setDecoration] = useState(user?.avatar_decoration ?? '')
  const [clanTag, setClanTag] = useState(user?.clan_tag ?? '')
  const [nameStyle, setNameStyle] = useState<NameStyle>({ font: (user?.name_style?.font as NameFont) ?? 'default', effect: (user?.name_style?.effect as NameEffect) ?? (user?.name_accent ? 'gradient' : 'solid') })
  const [styleOpen, setStyleOpen] = useState(false)
  const previewLook = nameLook({ name_primary: namePrimary, name_accent: nameAccent, name_style: nameStyle })
  const toLines = (items?: PanelItem[]) => (items ?? []).map((i) => (i.url ? `${i.title} | ${i.url}` : i.title)).join('\n')
  const fromLines = (text: string): PanelItem[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, url] = l.split('|').map((x) => x.trim()); return url ? { title, url } : { title } })
  const [wishlist, setWishlist] = useState(toLines(user?.panels?.wishlist))
  const [games, setGames] = useState(toLines(user?.panels?.games))
  const [busy, setBusy] = useState(false)
  const bannerRef = useRef<HTMLInputElement>(null)
  if (!user) return null

  const dirty = display !== user.display_name || pronouns !== (user.pronouns ?? '') || bio !== user.bio
    || decoration !== (user.avatar_decoration ?? '') || (nameStyle.font ?? 'default') !== (user.name_style?.font ?? 'default') || (nameStyle.effect ?? 'solid') !== (user.name_style?.effect ?? (user.name_accent ? 'gradient' : 'solid')) || clanTag !== (user.clan_tag ?? '') || wishlist !== toLines(user.panels?.wishlist) || games !== toLines(user.panels?.games)
    || (avatar ?? null) !== (user.avatar_url ?? null) || (banner ?? null) !== (user.banner_url ?? null)
    || (primary ?? null) !== (user.theme_primary ?? null) || (accent ?? null) !== (user.theme_accent ?? null)
    || (namePrimary ?? null) !== (user.name_primary ?? null) || (nameAccent ?? null) !== (user.name_accent ?? null)
  const reset = () => { setDisplay(user.display_name); setPronouns(user.pronouns ?? ''); setBio(user.bio); setAvatar(user.avatar_url); setBanner(user.banner_url ?? null); setPrimary(user.theme_primary ?? null); setAccent(user.theme_accent ?? null); setNamePrimary(user.name_primary ?? null); setNameAccent(user.name_accent ?? null); setDecoration(user.avatar_decoration ?? ''); setClanTag(user.clan_tag ?? ''); setNameStyle({ font: (user.name_style?.font as NameFont) ?? 'default', effect: (user.name_style?.effect as NameEffect) ?? (user.name_accent ? 'gradient' : 'solid') }); setWishlist(toLines(user.panels?.wishlist)); setGames(toLines(user.panels?.games)) }
  const save = async () => {
    setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', {
        display_name: display, pronouns, bio, avatar_url: avatar ?? '', banner_url: banner ?? '', theme_primary: primary ?? '', theme_accent: accent ?? '',
        name_primary: namePrimary ?? '', name_accent: namePrimary ? (nameAccent ?? '') : '',
        avatar_decoration: decoration, clan_tag: clanTag, name_style: nameStyle, panels: { wishlist: fromLines(wishlist), games: fromLines(games) },
      })
      if (token) setAuth(token, u)
      pushToast('Profile saved')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const pickBanner = async (f: File | undefined) => {
    if (!f) return
    try { setBanner((await uploadImage('banner', await prepareImage(f, 1200, 480))).url) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const base = primary ?? colorFor(user.id)

  return (
    <>
    <div>
      <h1 className="text-xl font-bold mb-5">Profiles</h1>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="flex-1 min-w-0 space-y-6">
          <div><label className="label">Display name</label><input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} required /></div>
          <div><label className="label">Pronouns</label><input className="input" value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder="Add your pronouns" /></div>
          <div><label className="label">Clan tag</label><input className="input w-32 uppercase" value={clanTag} onChange={(e) => setClanTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} maxLength={4} placeholder="TAG" data-clan-tag-input /><p className="text-xs text-text-2 mt-1">2–4 letters or digits shown beside your name everywhere. Leave empty for none.</p></div>
          <div>
            <label className="label">Avatar decoration</label>
            <div className="flex flex-wrap gap-2" data-decoration-options>
              {DECORATIONS.map((d) => (
                <button key={d.id} type="button" onClick={() => setDecoration(d.id)} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${decoration === d.id ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} data-decoration-option={d.id} aria-pressed={decoration === d.id}>
                  <Avatar user={{ ...user, avatar_url: avatar }} decoration={d.id} size={28} />{d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Avatar</label>
            <ImagePicker value={avatar} onChange={setAvatar} label={display} id={user.id} kind="avatar" />
            <p className="text-xs text-text-2 mt-1">PNG, JPEG, GIF or WebP up to 8 MB. Animated GIF, APNG and WebP stay animated.</p>
          </div>
          <div>
            <label className="label">Profile banner</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => bannerRef.current?.click()} className="group relative h-20 w-60 max-w-full overflow-hidden rounded-xl border-2 border-dashed border-line hover:border-accent flex items-center justify-center" style={{ background: banner ? undefined : 'rgba(0,0,0,0.25)' }}>
                {banner ? <img src={banner} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-text-2">Upload banner</span>}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white"><Camera size={22} /></span>
              </button>
              <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pickBanner(e.target.files?.[0]); e.target.value = '' }} data-banner-input />
              {banner && <button type="button" onClick={() => setBanner(null)} className="text-text-2 hover:text-danger" title="Remove banner"><Trash2 size={18} /></button>}
            </div>
            <p className="text-xs text-text-2 mt-1">Without a banner the card shows your theme colour. Still images are resized to 1200×480; animated ones are kept as uploaded.</p>
          </div>
          <div className="space-y-4 rounded-xl bg-bg-0/40 border border-line p-4">
            <ColorField label="Theme colour" value={primary} onChange={setPrimary} allowClear base={base} />
            <Toggle label="Gradient (add a second colour)" checked={accent !== null} onChange={(v) => setAccent(v ? (accent ?? '#6d5dfc') : null)} />
            {accent !== null && <ColorField label="Second colour" value={accent} onChange={(v) => setAccent(v ?? '#6d5dfc')} allowClear={false} base={base} />}
          </div>
          <div className="space-y-3 rounded-xl bg-bg-0/40 border border-line p-4" data-name-style-card>
            <div className="text-sm text-text-2">How your name appears in chat, DMs and lists. Inside a server a coloured role takes over.</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[15px] font-semibold"><span className={previewLook.className} style={previewLook.style} data-name-preview>{display || user.display_name}</span></span>
              <span className="text-xs text-text-2">{EFFECTS.find((e) => e.id === (nameStyle.effect ?? 'solid'))?.label} · {FONTS.find((f) => f.id === (nameStyle.font ?? 'default'))?.label}{namePrimary ? '' : ' · no colour'}</span>
              <button type="button" className="btn-ghost bg-bg-3 hover:bg-bg-4 ml-auto" onClick={() => setStyleOpen(true)} data-name-style-open>Change Display Name Style</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1" data-panels>
            <div><label className="label">Wishlist panel</label><textarea className="input resize-none font-mono text-[13px]" rows={4} value={wishlist} onChange={(e) => setWishlist(e.target.value)} placeholder={'One per line: Title | https://link (link optional)'} data-panel-wishlist /></div>
            <div><label className="label">Game collection panel</label><textarea className="input resize-none font-mono text-[13px]" rows={4} value={games} onChange={(e) => setGames(e.target.value)} placeholder={'One per line: Title | https://link (link optional)'} data-panel-games /></div>
            <p className="col-span-full -mt-2 text-xs text-text-2">Optional sections on your profile card, up to 25 items each. Leave empty to hide.</p>
          </div>
          <div>
            <label className="label">About me</label>
            <textarea className="input resize-none font-mono text-[13px]" rows={5} maxLength={MAX_BIO} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people a bit about yourself" />
            <div className="flex justify-between text-[11px] text-text-2 mt-1"><span>Supports **bold**, *italic*, __underline__, ~~strike~~, `code`, &gt; quotes and links.</span><span>{bio.length}/{MAX_BIO}</span></div>
          </div>
        </div>
        <div className="w-[340px] max-lg:w-full shrink-0">
          <div className="label">Preview</div>
          <ProfileCard user={{ ...user, display_name: display || user.display_name, pronouns, bio, avatar_url: avatar, avatar_decoration: decoration, name_style: nameStyle, banner_url: banner, theme_primary: primary, theme_accent: accent, name_primary: namePrimary, name_accent: nameAccent }} />
        </div>
      </div>
      {dirty && (
        <div className="sticky bottom-4 mt-6 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">Careful — you have unsaved changes!</span>
          <button type="button" className="btn-ghost" onClick={reset}>Reset</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !display.trim()} onClick={save}>Save Changes</button>
        </div>
      )}
    </div>
    {styleOpen && <NameStyleModal onClose={() => setStyleOpen(false)} name={display || user.display_name} primary={namePrimary} accent={nameAccent} style={nameStyle} onApply={(v) => { setNamePrimary(v.primary); setNameAccent(v.accent); setNameStyle({ font: v.font, effect: v.effect }); setStyleOpen(false) }} />}
    </>
  )
}

function ColorField({ label, value, onChange, allowClear, base }: { label: string; value: string | null; onChange: (v: string | null) => void; allowClear: boolean; base: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="relative h-9 w-14 rounded-md border border-line overflow-hidden cursor-pointer" style={{ background: value ?? base }} title="Custom colour">
          <input type="color" value={value ?? base} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        {ROLE_COLORS.slice(0, 12).map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} className={`h-7 w-7 rounded-md border-2 ${value === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} title={c} />
        ))}
        {allowClear && value && <button type="button" onClick={() => onChange(null)} className="text-xs text-text-2 hover:text-text-0">Reset</button>}
      </div>
    </div>
  )
}
