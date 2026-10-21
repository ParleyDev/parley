import { Camera, Trash2, Pipette } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { DECORATIONS, type PanelItem, type PrivateUser } from '../../../lib/types'
import { colorsOf, EFFECTS, FONTS, nameLook, type NameEffect, type NameFont, type NameStyle } from '../../../lib/nameStyle'

/** The user's saved style as the editor's draft (colours fall back to the classic fields). */
const styleOfUser = (u: PrivateUser | null | undefined): NameStyle => ({ font: (u?.name_style?.font as NameFont) ?? 'default', effect: (u?.name_style?.effect as NameEffect) ?? (u?.name_accent ? 'gradient' : 'solid'), colors: colorsOf(u ?? undefined) })
import NameStyleModal from '../NameStyle'
import { colorFor } from '../../../lib/format'
import { prepareImage, uploadImage } from '../../../lib/upload'
import ImagePicker from '../ImagePicker'
import ProfileCard from '../../ProfileCard'
import Avatar from '../../Avatar'

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
  const [decoration, setDecoration] = useState(user?.avatar_decoration ?? '')
  const [clanTag, setClanTag] = useState(user?.clan_tag ?? '')
  const [nameStyle, setNameStyle] = useState<NameStyle>(() => styleOfUser(user))
  const [styleOpen, setStyleOpen] = useState(false)
  const previewLook = nameLook({ name_style: nameStyle })
  const toLines = (items?: PanelItem[]) => (items ?? []).map((i) => (i.url ? `${i.title} | ${i.url}` : i.title)).join('\n')
  const fromLines = (text: string): PanelItem[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, url] = l.split('|').map((x) => x.trim()); return url ? { title, url } : { title } })
  const [wishlist, setWishlist] = useState(toLines(user?.panels?.wishlist))
  const [games, setGames] = useState(toLines(user?.panels?.games))
  const [busy, setBusy] = useState(false)
  const bannerRef = useRef<HTMLInputElement>(null)
  if (!user) return null

  const dirty = display !== user.display_name || pronouns !== (user.pronouns ?? '') || bio !== user.bio
    || decoration !== (user.avatar_decoration ?? '') || JSON.stringify(nameStyle) !== JSON.stringify(styleOfUser(user)) || clanTag !== (user.clan_tag ?? '') || wishlist !== toLines(user.panels?.wishlist) || games !== toLines(user.panels?.games)
    || (avatar ?? null) !== (user.avatar_url ?? null) || (banner ?? null) !== (user.banner_url ?? null)
    || (primary ?? null) !== (user.theme_primary ?? null) || (accent ?? null) !== (user.theme_accent ?? null)
  const reset = () => { setDisplay(user.display_name); setPronouns(user.pronouns ?? ''); setBio(user.bio); setAvatar(user.avatar_url); setBanner(user.banner_url ?? null); setPrimary(user.theme_primary ?? null); setAccent(user.theme_accent ?? null); setDecoration(user.avatar_decoration ?? ''); setClanTag(user.clan_tag ?? ''); setNameStyle(styleOfUser(user)); setWishlist(toLines(user.panels?.wishlist)); setGames(toLines(user.panels?.games)) }
  const save = async () => {
    setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', {
        display_name: display, pronouns, bio, avatar_url: avatar ?? '', banner_url: banner ?? '', theme_primary: primary ?? '', theme_accent: accent ?? '',
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
          <div className="space-y-2 rounded-xl bg-bg-0/40 border border-line p-4" data-theme-card>
            <label className="label">Profile theme</label>
            <div className="relative h-28 w-full max-w-[260px] rounded-xl" style={{ background: `linear-gradient(180deg, ${primary ?? base}, ${accent ?? primary ?? base})` }} data-theme-box>
              <label className="absolute left-1/2 -translate-x-1/2 top-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title="Primary colour"><Pipette size={13} /><input type="color" value={primary ?? base} onChange={(e) => setPrimary(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-primary /></label>
              <label className="absolute left-1/2 -translate-x-1/2 bottom-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title="Accent colour"><Pipette size={13} /><input type="color" value={accent ?? primary ?? base} onChange={(e) => setAccent(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-accent /></label>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-2">
              <span>Tints your profile card top to bottom.</span>
              {(primary || accent) && <button type="button" className="hover:text-text-0" onClick={() => { setPrimary(null); setAccent(null) }} data-theme-reset>Reset</button>}
              {accent && primary && accent !== primary && <button type="button" className="hover:text-text-0" onClick={() => setAccent(null)} data-theme-single>Single colour</button>}
            </div>
          </div>
          <div className="space-y-3 rounded-xl bg-bg-0/40 border border-line p-4" data-name-style-card>
            <div className="text-sm text-text-2">How your name appears in chat, DMs and lists. Inside a server a coloured role takes over.</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[15px] font-semibold"><span className={previewLook.className} style={previewLook.style} data-name-preview>{display || user.display_name}</span></span>
              <span className="text-xs text-text-2">{EFFECTS.find((e) => e.id === (nameStyle.effect ?? 'solid'))?.label} · {FONTS.find((f) => f.id === (nameStyle.font ?? 'default'))?.label}{nameStyle.colors?.length ? '' : ' · no colour'}</span>
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
          <ProfileCard user={{ ...user, display_name: display || user.display_name, pronouns, bio, avatar_url: avatar, avatar_decoration: decoration, name_style: nameStyle, name_primary: nameStyle.colors?.[0] ?? null, name_accent: nameStyle.colors?.[1] ?? null, banner_url: banner, theme_primary: primary, theme_accent: accent}} />
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
    {styleOpen && <NameStyleModal onClose={() => setStyleOpen(false)} name={display || user.display_name} value={nameStyle} onApply={(v) => { setNameStyle(v); setStyleOpen(false) }} />}
    </>
  )
}

