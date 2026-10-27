import { Camera, Trash2, Pipette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { DECORATIONS, type PanelItem, type PrivateUser } from '../../../lib/types'
import { colorsOf, EFFECTS, FONTS, nameLook, type NameEffect, type NameFont, type NameStyle } from '../../../lib/nameStyle'

/** The user's saved style as the editor's draft (colours fall back to the classic fields). */
const styleOfUser = (u: PrivateUser | null | undefined): NameStyle => ({ font: (u?.name_style?.font as NameFont) ?? 'default', effect: (u?.name_style?.effect as NameEffect) ?? (u?.name_accent ? 'gradient' : 'solid'), colors: colorsOf(u ?? undefined) })
import NameStyleModal from '../NameStyle'
import DecorationGallery from './DecorationGallery'
import { colorFor } from '../../../lib/format'
import { prepareImage, uploadImage } from '../../../lib/upload'
import ImagePicker from '../ImagePicker'
import { NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES, nameplateClass } from '../../../lib/cosmetics'
import { FORMATS, toggleWrap } from '../../../lib/editor'
import ProfileCard, { type ProfileEdit } from '../../ProfileCard'
import { WearServerTag } from '../../ServerTag'
import Avatar from '../../Avatar'
import { useT } from '../../../lib/i18n'

const MAX_BIO = 400

/** Everything about how your profile card looks, with a live preview. */
export default function ProfilesTab() {
  const t = useT()
  const user = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const pushToast = useStore((s) => s.pushToast)
  const [display, setDisplay] = useState(user?.display_name ?? '')
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '')
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const presence = useStore((s) => (s.user ? s.users[s.user.id]?.status ?? s.user.status : 'online'))
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatar, setAvatar] = useState<string | null>(user?.avatar_url ?? null)
  const [banner, setBanner] = useState<string | null>(user?.banner_url ?? null)
  const [primary, setPrimary] = useState<string | null>(user?.theme_primary ?? null)
  const [accent, setAccent] = useState<string | null>(user?.theme_accent ?? null)
  const [decoration, setDecoration] = useState(user?.avatar_decoration ?? '')
  const [clanTag, setClanTag] = useState(user?.clan_tag ?? '')
  // Wearing (or dropping) a server tag elsewhere changes it under us: keep the field in step.
  useEffect(() => { setClanTag(user?.clan_tag ?? '') }, [user?.clan_tag])
  const [nameStyle, setNameStyle] = useState<NameStyle>(() => styleOfUser(user))
  const [styleOpen, setStyleOpen] = useState(false)
  const previewLook = nameLook({ name_style: nameStyle })
  const toLines = (items?: PanelItem[]) => (items ?? []).map((i) => (i.url ? `${i.title} | ${i.url}` : i.title)).join('\n')
  const fromLines = (text: string): PanelItem[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, url] = l.split('|').map((x) => x.trim()); return url ? { title, url } : { title } })
  const [wishlist, setWishlist] = useState(toLines(user?.panels?.wishlist))
  const [games, setGames] = useState(toLines(user?.panels?.games))
  const [privacy, setPrivacy] = useState<'everyone' | 'friends'>(user?.profile_privacy ?? 'everyone')
  const [frame, setFrame] = useState(user?.profile_frame ?? '')
  const [plate, setPlate] = useState(user?.nameplate ?? '')
  const [effect, setEffect] = useState(user?.profile_effect ?? '')
  const bioRef = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const bannerRef = useRef<HTMLInputElement>(null)
  if (!user) return null

  const dirty = display !== user.display_name || pronouns !== (user.pronouns ?? '') || customStatus !== (user.custom_status ?? '') || bio !== user.bio
    || decoration !== (user.avatar_decoration ?? '') || JSON.stringify(nameStyle) !== JSON.stringify(styleOfUser(user)) || clanTag !== (user.clan_tag ?? '') || wishlist !== toLines(user.panels?.wishlist) || games !== toLines(user.panels?.games)
    || (avatar ?? null) !== (user.avatar_url ?? null) || (banner ?? null) !== (user.banner_url ?? null)
    || (primary ?? null) !== (user.theme_primary ?? null) || (accent ?? null) !== (user.theme_accent ?? null)
    || privacy !== (user.profile_privacy ?? 'everyone') || frame !== (user.profile_frame ?? '') || plate !== (user.nameplate ?? '') || effect !== (user.profile_effect ?? '')
  const reset = () => { setDisplay(user.display_name); setPronouns(user.pronouns ?? ''); setCustomStatus(user.custom_status ?? ''); setBio(user.bio); setAvatar(user.avatar_url); setBanner(user.banner_url ?? null); setPrimary(user.theme_primary ?? null); setAccent(user.theme_accent ?? null); setDecoration(user.avatar_decoration ?? ''); setClanTag(user.clan_tag ?? ''); setNameStyle(styleOfUser(user)); setWishlist(toLines(user.panels?.wishlist)); setGames(toLines(user.panels?.games)); setPrivacy(user.profile_privacy ?? 'everyone'); setFrame(user.profile_frame ?? ''); setPlate(user.nameplate ?? ''); setEffect(user.profile_effect ?? '') }
  const save = async () => {
    setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', {
        display_name: display, pronouns, custom_status: customStatus, bio, avatar_url: avatar ?? '', banner_url: banner ?? '', theme_primary: primary ?? '', theme_accent: accent ?? '',
        avatar_decoration: decoration, clan_tag: clanTag, name_style: nameStyle, panels: { wishlist: fromLines(wishlist), games: fromLines(games) },
        profile_privacy: privacy, profile_frame: frame, nameplate: plate, profile_effect: effect,
      })
      if (token) setAuth(token, u)
      pushToast(t('Profile saved'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const pickBanner = async (f: File | undefined) => {
    if (!f) return
    setUploading('banner')
    try { setBanner((await uploadImage('banner', await prepareImage(f, 1200, 480))).url) } catch (e) { pushToast((e as Error).message, 'error') } finally { setUploading(null) }
  }
  const pickAvatar = async (f: File) => {
    setUploading('avatar')
    try { setAvatar((await uploadImage('avatar', await prepareImage(f, 512, 512))).url) } catch (e) { pushToast((e as Error).message, 'error') } finally { setUploading(null) }
  }
  const setPresence = async (v: string) => { try { await api.patch('/users/@me', { status: v }) } catch (e) { pushToast((e as Error).message, 'error') } }
  const edit: ProfileEdit = {
    onDisplayName: setDisplay, onPronouns: setPronouns, onCustomStatus: setCustomStatus,
    onAvatarFile: pickAvatar, onAvatarRemove: () => setAvatar(null), onBannerFile: pickBanner, onBannerRemove: () => setBanner(null),
    status: presence, onStatus: setPresence, busy: uploading,
  }
  const base = primary ?? colorFor(user.id)

  return (
    <>
    <div>
      <h1 className="text-xl font-bold mb-5">{t('Profiles')}</h1>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="flex-1 min-w-0 space-y-6">
          <div><label className="label">{t('Display name')}</label><input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} required /></div>
          <div><label className="label">{t('Pronouns')}</label><input className="input" value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder={t('Add your pronouns')} /></div>
          <div><label className="label">{t('Custom status')}</label><input className="input" value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} maxLength={128} placeholder={t('Support has arrived!')} data-profile-custom-status /></div>
          <div><label className="label">{t('Clan tag')}</label><input className="input w-32 uppercase" value={clanTag} onChange={(e) => setClanTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} maxLength={4} placeholder="TAG" data-clan-tag-input /><p className="text-xs text-text-2 mt-1">{t('2–4 letters or digits shown beside your name everywhere. Leave empty for none.')}</p></div>
          <WearServerTag />
          <div>
            <label className="label">{t('Avatar decoration')}</label>
            <div className="flex flex-wrap gap-2" data-decoration-options>
              {DECORATIONS.map((d) => (
                <button key={d.id} type="button" onClick={() => setDecoration(d.id)} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${decoration === d.id ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} data-decoration-option={d.id} aria-pressed={decoration === d.id}>
                  <Avatar user={{ ...user, avatar_url: avatar }} decoration={d.id} size={28} />{d.label}
                </button>
              ))}
            </div>
            <DecorationGallery user={{ ...user, avatar_url: avatar }} value={decoration} onChange={setDecoration} />
          </div>
          <div>
            <label className="label">{t('Avatar')}</label>
            <ImagePicker value={avatar} onChange={setAvatar} label={display} id={user.id} kind="avatar" />
            {(user.avatar_history?.length ?? 0) > 0 && (
              <div className="mt-2" data-avatar-history>
                <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-1">{t('Recent avatars')}</div>
                <div className="flex flex-wrap gap-2">
                  {user.avatar_history!.map((url) => <button key={url} type="button" onClick={() => setAvatar(url)} className={`h-10 w-10 overflow-hidden rounded-full border-2 ${avatar === url ? 'border-accent' : 'border-transparent hover:border-text-2'}`} title={t('Use this avatar again')} data-avatar-history-item={url}><img src={url} alt="" className="h-full w-full object-cover" /></button>)}
                </div>
              </div>
            )}
            <p className="text-xs text-text-2 mt-1">{t('PNG, JPEG, GIF or WebP up to 8 MB. Animated GIF, APNG and WebP stay animated.')}</p>
          </div>
          <div>
            <label className="label">{t('Profile banner')}</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => bannerRef.current?.click()} className="group relative h-20 w-60 max-w-full overflow-hidden rounded-xl border-2 border-dashed border-line hover:border-accent flex items-center justify-center" style={{ background: banner ? undefined : 'rgba(0,0,0,0.25)' }}>
                {banner ? <img src={banner} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-text-2">{t('Upload banner')}</span>}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white"><Camera size={22} /></span>
              </button>
              <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pickBanner(e.target.files?.[0]); e.target.value = '' }} data-banner-input />
              {banner && <button type="button" onClick={() => setBanner(null)} className="text-text-2 hover:text-danger" title={t('Remove banner')}><Trash2 size={18} /></button>}
            </div>
            <p className="text-xs text-text-2 mt-1">{t('Without a banner the card shows your theme colour. Still images are resized to 1200×480; animated ones are kept as uploaded.')}</p>
          </div>
          <div className="space-y-2 rounded-xl bg-bg-0/40 border border-line p-4" data-theme-card>
            <label className="label">{t('Profile theme')}</label>
            <div className="relative h-28 w-full max-w-[260px] rounded-xl" style={{ background: `linear-gradient(180deg, ${primary ?? base}, ${accent ?? primary ?? base})` }} data-theme-box>
              <label className="absolute left-1/2 -translate-x-1/2 top-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title={t('Primary colour')}><Pipette size={13} /><input type="color" value={primary ?? base} onChange={(e) => setPrimary(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-primary /></label>
              <label className="absolute left-1/2 -translate-x-1/2 bottom-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title={t('Accent colour')}><Pipette size={13} /><input type="color" value={accent ?? primary ?? base} onChange={(e) => setAccent(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-accent /></label>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-2">
              <span>{t('Tints your profile card top to bottom.')}</span>
              {(primary || accent) && <button type="button" className="hover:text-text-0" onClick={() => { setPrimary(null); setAccent(null) }} data-theme-reset>{t('Reset')}</button>}
              {accent && primary && accent !== primary && <button type="button" className="hover:text-text-0" onClick={() => setAccent(null)} data-theme-single>{t('Single colour')}</button>}
            </div>
          </div>
          <div className="space-y-3 rounded-xl bg-bg-0/40 border border-line p-4" data-name-style-card>
            <div className="text-sm text-text-2">{t('How your name appears in chat, DMs and lists. Inside a server a coloured role takes over.')}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[15px] font-semibold"><span className={previewLook.className} style={previewLook.style} data-name-preview>{display || user.display_name}</span></span>
              <span className="text-xs text-text-2">{EFFECTS.find((e) => e.id === (nameStyle.effect ?? 'solid'))?.label} · {FONTS.find((f) => f.id === (nameStyle.font ?? 'default'))?.label}{nameStyle.colors?.length ? '' : ` · ${t('no colour')}`}</span>
              <button type="button" className="btn-ghost bg-bg-3 hover:bg-bg-4 ml-auto" onClick={() => setStyleOpen(true)} data-name-style-open>{t('Change Display Name Style')}</button>
            </div>
          </div>
          <div className="space-y-3 rounded-xl bg-bg-0/40 border border-line p-4" data-cosmetics>
            <div>
              <label className="label">{t('Profile frame')}</label>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', label: t('None') }, ...PROFILE_FRAMES].map((f) => <button key={f.id || 'none'} type="button" onClick={() => setFrame(f.id)} className={`rounded-lg border px-2.5 py-1 text-sm ${frame === f.id ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} data-frame-option={f.id || 'none'} aria-pressed={frame === f.id}>{f.label}</button>)}
              </div>
            </div>
            <div>
              <label className="label">{t('Nameplate')}</label>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', label: t('None') }, ...NAMEPLATES].map((n) => <button key={n.id || 'none'} type="button" onClick={() => setPlate(n.id)} className={`rounded-lg border px-2.5 py-1 text-sm ${nameplateClass(n.id)} ${plate === n.id ? 'border-accent' : 'border-line hover:border-text-2'}`} data-nameplate-option={n.id || 'none'} aria-pressed={plate === n.id}>{n.label}</button>)}
              </div>
              <p className="mt-1 text-xs text-text-2">{t('Shown behind your name in member lists and DMs.')}</p>
            </div>
            <div>
              <label className="label">{t('Profile effect')}</label>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', label: t('None'), glyph: '' }, ...PROFILE_EFFECTS].map((e) => <button key={e.id || 'none'} type="button" onClick={() => setEffect(e.id)} className={`rounded-lg border px-2.5 py-1 text-sm ${effect === e.id ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} data-effect-option={e.id || 'none'} aria-pressed={effect === e.id}>{e.glyph} {e.label}</button>)}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="profile-privacy">{t('Who can see your full profile')}</label>
              <select id="profile-privacy" className="input w-auto" value={privacy} onChange={(e) => setPrivacy(e.target.value as 'everyone' | 'friends')} data-profile-privacy>
                <option value="everyone">{t('Everyone')}</option>
                <option value="friends">{t('Friends only')}</option>
              </select>
              <p className="mt-1 text-xs text-text-2">{t('Friends only hides your about me, banner, pronouns and panels from everyone else.')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1" data-panels>
            <div><label className="label">{t('Wishlist panel')}</label><textarea className="input resize-none font-mono text-[13px]" rows={4} value={wishlist} onChange={(e) => setWishlist(e.target.value)} placeholder={t('One per line: Title | https://link (link optional)')} data-panel-wishlist /></div>
            <div><label className="label">{t('Game collection panel')}</label><textarea className="input resize-none font-mono text-[13px]" rows={4} value={games} onChange={(e) => setGames(e.target.value)} placeholder={t('One per line: Title | https://link (link optional)')} data-panel-games /></div>
            <p className="col-span-full -mt-2 text-xs text-text-2">{t('Optional sections on your profile card, up to 25 items each. Leave empty to hide.')}</p>
          </div>
          <div>
            <label className="label">{t('About me')}</label>
            <div className="mb-1 flex gap-0.5" data-bio-toolbar>
              {FORMATS.map((f) => <button key={f.key} type="button" title={f.label} aria-label={f.label} onMouseDown={(e) => e.preventDefault()} onClick={() => { const el = bioRef.current; if (el) { el.focus(); setBio(toggleWrap(el, f)) } }} className="h-8 min-w-8 rounded-md px-2 text-sm text-text-1 hover:bg-bg-3 hover:text-text-0" data-bio-format={f.key}>{f.label}</button>)}
            </div>
            <textarea ref={bioRef} className="input resize-none text-[14px]" rows={5} maxLength={MAX_BIO} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('Tell people a bit about yourself')} data-bio-input />
            <div className="flex justify-between text-[11px] text-text-2 mt-1"><span>{t('Select text and use the buttons above, or type **bold**, *italic*, __underline__, ~~strike~~ and links. The preview shows how it looks.')}</span><span>{bio.length}/{MAX_BIO}</span></div>
          </div>
        </div>
        <div className="w-[340px] max-lg:w-full shrink-0">
          <div className="label">{t('Preview')}</div>
          <p className="-mt-1 mb-2 text-xs text-text-2">{t('Click your name, pronouns, status, avatar or banner to change them here.')}</p>
          <ProfileCard edit={edit} user={{ ...user, display_name: display || user.display_name, pronouns, custom_status: customStatus, bio, avatar_url: avatar, avatar_decoration: decoration, name_style: nameStyle, name_primary: nameStyle.colors?.[0] ?? null, name_accent: nameStyle.colors?.[1] ?? null, banner_url: banner, theme_primary: primary, theme_accent: accent, profile_frame: frame, profile_effect: effect}} />
        </div>
      </div>
      {dirty && (
        <div className="sticky bottom-4 mt-6 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">{t('Careful — you have unsaved changes!')}</span>
          <button type="button" className="btn-ghost" onClick={reset}>{t('Reset')}</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !display.trim()} onClick={save}>{t('Save Changes')}</button>
        </div>
      )}
    </div>
    {styleOpen && <NameStyleModal onClose={() => setStyleOpen(false)} name={display || user.display_name} value={nameStyle} onApply={(v) => { setNameStyle(v); setStyleOpen(false) }} />}
    </>
  )
}

