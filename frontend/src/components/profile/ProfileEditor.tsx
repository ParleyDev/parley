import { useShallow } from 'zustand/react/shallow'
import { Camera, ChevronDown, Pipette, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../../lib/api'
import { NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES, nameplateClass } from '../../lib/cosmetics'
import { FORMATS, toggleWrap } from '../../lib/editor'
import { colorFor } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { colorsOf, nameLook, type NameEffect, type NameFont, type NameStyle } from '../../lib/nameStyle'
import { prepareImage, uploadImage } from '../../lib/upload'
import { DECORATIONS, type ManualActivity, type PanelItem, type PrivateUser } from '../../lib/types'
import { useStore } from '../../store'
import Avatar from '../Avatar'
import { badgeIcon, HOUSES } from '../Flair'
import { AssetNameplatePicker, isAssetNameplate, NameplateVideo } from '../Nameplate'
import LayeredPicker, { layeredThumb } from './LayeredPicker'
import { useAssetItem, type EffectItem, type FrameItem } from '../../lib/assetCatalog'
import ProfileCard, { type ProfileEdit } from '../ProfileCard'
import { WearServerTag } from '../ServerTag'
import ImagePicker from '../modals/ImagePicker'
import NameStyleModal from '../modals/NameStyle'
import DecorationGallery from '../modals/settings/DecorationGallery'

const MAX_BIO = 400

/** The user's saved style as the editor's draft (colours fall back to the classic fields). */
const styleOfUser = (u: PrivateUser | null | undefined): NameStyle => ({ font: (u?.name_style?.font as NameFont) ?? 'default', effect: (u?.name_style?.effect as NameEffect) ?? (u?.name_accent ? 'gradient' : 'solid'), colors: colorsOf(u ?? undefined) })
const toLines = (items?: PanelItem[]) => (items ?? []).map((i) => (i.url ? `${i.title} | ${i.url}` : i.title)).join('\n')
const fromLines = (text: string): PanelItem[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, url] = l.split('|').map((x) => x.trim()); return url ? { title, url } : { title } })

/** Everything the profile editor changes, as an unsaved draft of the signed-in user. */
function useProfileDraft(user: PrivateUser) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const initialOf = (user: PrivateUser) => ({
    display: user.display_name, pronouns: user.pronouns ?? '', customStatus: user.custom_status ?? '', bio: user.bio,
    avatar: user.avatar_url ?? null, banner: user.banner_url ?? null, primary: user.theme_primary ?? null, accent: user.theme_accent ?? null,
    decoration: user.avatar_decoration ?? '', clanTag: user.clan_tag ?? '', nameStyle: styleOfUser(user),
    wishlist: toLines(user.panels?.wishlist), games: toLines(user.panels?.games), privacy: (user.profile_privacy ?? 'everyone') as 'everyone' | 'friends',
    frame: user.profile_frame ?? '', plate: user.nameplate ?? '', effect: user.profile_effect ?? '',
  })
  const initial = () => initialOf(user)
  const [d, setD] = useState(initial)
  const set = <K extends keyof ReturnType<typeof initial>>(k: K) => (v: ReturnType<typeof initial>[K]) => setD((x) => ({ ...x, [k]: v }))
  // Wearing (or dropping) a server tag elsewhere changes it under us: keep the field in step.
  useEffect(() => { setD((x) => ({ ...x, clanTag: user.clan_tag ?? '' })) }, [user.clan_tag])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial())
  const save = async () => {
    setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', {
        display_name: d.display, pronouns: d.pronouns, custom_status: d.customStatus, bio: d.bio, avatar_url: d.avatar ?? '', banner_url: d.banner ?? '', theme_primary: d.primary ?? '', theme_accent: d.accent ?? '',
        avatar_decoration: d.decoration, clan_tag: d.clanTag, name_style: d.nameStyle, panels: { wishlist: fromLines(d.wishlist), games: fromLines(d.games) },
        profile_privacy: d.privacy, profile_frame: d.frame, nameplate: d.plate, profile_effect: d.effect,
      })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
      setD(initialOf(u)); pushToast(t('Profile saved'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const upload = async (kind: 'avatar' | 'banner', f: File) => {
    setUploading(kind)
    try {
      const url = (await uploadImage(kind, await prepareImage(f, kind === 'avatar' ? 512 : 1200, kind === 'avatar' ? 512 : 480))).url
      setD((x) => ({ ...x, [kind]: url }))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setUploading(null) }
  }
  return { d, set, dirty, save, busy, uploading, upload, reset: () => setD(initial()) }
}

type Section = 'nameplate' | 'avatar' | 'decoration' | 'theme' | 'banner' | 'effect' | 'frame' | 'tag' | 'badges'

/** A tile in the left column: a little preview of the setting that opens its picker. */
function Tile({ section, open, onOpen, label, children, className = '' }: { section: Section; open: Section | null; onOpen: (s: Section) => void; label: string; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => onOpen(section)} title={label} aria-label={label} aria-pressed={open === section}
      className={`relative isolate overflow-hidden rounded-xl bg-black/25 border-2 hover:border-white/40 ${open === section ? 'border-accent' : 'border-transparent'} ${className}`} data-editor-section={section}>
      {children}
    </button>
  )
}
const Heading = ({ children }: { children: ReactNode }) => <h3 className="text-[15px] font-bold mb-2 text-[#f2f3f5]">{children}</h3>

/**
 * The profile editor (Discord's Edit Profile): tiles on the left for each kind of change, the live profile card in
 * the middle (click your name, pronouns, status, avatar or banner on it to change them there), and About Me,
 * Activity, Wishlist and Games on the right. Changes are a draft until Save; presence, house badges and activities
 * apply straight away.
 */
export default function ProfileEditor() {
  const t = useT()
  const user = useStore((s) => s.user)!
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const presence = useStore((s) => s.users[user.id]?.status ?? user.status)
  const { d, set, dirty, save, busy, uploading, upload, reset } = useProfileDraft(user)
  const [section, setSection] = useState<Section | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [tab, setTab] = useState<'about' | 'activity' | 'wishlist' | 'games'>('about')
  const [who, setWho] = useState(false)
  // Escape closes an open picker first (the overlay closes on the next one).
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && section && !document.querySelector('[data-name-style-modal]')) setSection(null) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [section])
  const bioRef = useRef<HTMLTextAreaElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const base = d.primary ?? colorFor(user.id)
  const look = nameLook({ name_style: d.nameStyle })
  const draftUser = { ...user, display_name: d.display || user.display_name, pronouns: d.pronouns, custom_status: d.customStatus, bio: d.bio, avatar_url: d.avatar, avatar_decoration: d.decoration, name_style: d.nameStyle, name_primary: d.nameStyle.colors?.[0] ?? null, name_accent: d.nameStyle.colors?.[1] ?? null, banner_url: d.banner, theme_primary: d.primary, theme_accent: d.accent, profile_frame: d.frame, profile_effect: d.effect }
  const effectItem = useAssetItem<EffectItem>('profile-effects', d.effect)
  const frameItem = useAssetItem<FrameItem>('profile-frames', d.frame)
  const edit: ProfileEdit = {
    onDisplayName: set('display'), onPronouns: set('pronouns'), onCustomStatus: set('customStatus'),
    onAvatarFile: (f) => void upload('avatar', f), onAvatarRemove: () => set('avatar')(null), onBannerFile: (f) => void upload('banner', f), onBannerRemove: () => set('banner')(null),
    status: presence, onStatus: (v) => { api.patch('/users/@me', { status: v }).catch((e) => pushToast((e as Error).message, 'error')) }, busy: uploading,
  }
  const chip = (on: boolean) => `rounded-lg border px-2.5 py-1 text-sm ${on ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`

  const panel: Record<Section, { title: string; body: ReactNode }> = {
    nameplate: { title: t('Nameplate'), body: (
      <>
        <div className="flex flex-wrap gap-2">
          {[{ id: '', label: t('None') }, ...NAMEPLATES].map((n) => <button key={n.id || 'none'} type="button" onClick={() => set('plate')(n.id)} className={`rounded-lg border px-2.5 py-1 text-sm ${nameplateClass(n.id)} ${d.plate === n.id ? 'border-accent' : 'border-line hover:border-text-2'}`} data-nameplate-option={n.id || 'none'} aria-pressed={d.plate === n.id}>{n.label}</button>)}
        </div>
        <AssetNameplatePicker value={d.plate} onPick={set('plate')} />
        <p className="mt-2 text-xs text-text-2">{t('Shown behind your name in member lists and DMs.')}</p>
      </>
    ) },
    avatar: { title: t('Avatar'), body: (
      <>
        <ImagePicker value={d.avatar} onChange={set('avatar')} label={d.display} id={user.id} kind="avatar" />
        {(user.avatar_history?.length ?? 0) > 0 && (
          <div className="mt-3" data-avatar-history>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-1">{t('Recent avatars')}</div>
            <div className="flex flex-wrap gap-2">
              {user.avatar_history!.map((url) => <button key={url} type="button" onClick={() => set('avatar')(url)} className={`h-10 w-10 overflow-hidden rounded-full border-2 ${d.avatar === url ? 'border-accent' : 'border-transparent hover:border-text-2'}`} title={t('Use this avatar again')} data-avatar-history-item={url}><img src={url} alt="" className="h-full w-full object-cover" /></button>)}
            </div>
          </div>
        )}
        <p className="text-xs text-text-2 mt-2">{t('PNG, JPEG, GIF or WebP up to 8 MB. Animated GIF, APNG and WebP stay animated.')}</p>
      </>
    ) },
    decoration: { title: t('Avatar decoration'), body: (
      <>
        <div className="flex flex-wrap gap-2" data-decoration-options>
          {DECORATIONS.map((x) => (
            <button key={x.id} type="button" onClick={() => set('decoration')(x.id)} className={`flex items-center gap-2 ${chip(d.decoration === x.id)} py-1.5`} data-decoration-option={x.id} aria-pressed={d.decoration === x.id}>
              <Avatar user={{ ...user, avatar_url: d.avatar }} decoration={x.id} size={28} />{x.label}
            </button>
          ))}
        </div>
        <DecorationGallery user={{ ...user, avatar_url: d.avatar }} value={d.decoration} onChange={set('decoration')} />
      </>
    ) },
    theme: { title: t('Profile theme'), body: (
      <div className="space-y-2" data-theme-card>
        <div className="relative h-28 w-full max-w-[260px] rounded-xl" style={{ background: `linear-gradient(180deg, ${d.primary ?? base}, ${d.accent ?? d.primary ?? base})` }} data-theme-box>
          <label className="absolute left-1/2 -translate-x-1/2 top-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title={t('Primary colour')}><Pipette size={13} /><input type="color" value={d.primary ?? base} onChange={(e) => set('primary')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-primary /></label>
          <label className="absolute left-1/2 -translate-x-1/2 bottom-3 h-8 w-8 rounded-full border-2 border-white/80 bg-white/20 backdrop-blur cursor-pointer flex items-center justify-center text-white" title={t('Accent colour')}><Pipette size={13} /><input type="color" value={d.accent ?? d.primary ?? base} onChange={(e) => set('accent')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-theme-accent /></label>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-2">
          <span>{t('Tints your profile card top to bottom.')}</span>
          {(d.primary || d.accent) && <button type="button" className="hover:text-text-0" onClick={() => { set('primary')(null); set('accent')(null) }} data-theme-reset>{t('Reset')}</button>}
          {d.accent && d.primary && d.accent !== d.primary && <button type="button" className="hover:text-text-0" onClick={() => set('accent')(null)} data-theme-single>{t('Single colour')}</button>}
        </div>
      </div>
    ) },
    banner: { title: t('Profile banner'), body: (
      <>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => bannerRef.current?.click()} className="group relative h-24 w-72 max-w-full overflow-hidden rounded-xl border-2 border-dashed border-line hover:border-accent flex items-center justify-center" data-banner-pick>
            {d.banner ? <img src={d.banner} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-text-2">{t('Upload banner')}</span>}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white"><Camera size={22} /></span>
          </button>
          {d.banner && <button type="button" onClick={() => set('banner')(null)} className="text-text-2 hover:text-danger" title={t('Remove banner')}><Trash2 size={18} /></button>}
        </div>
        <p className="text-xs text-text-2 mt-2">{t('Without a banner the card shows your theme colour. Still images are resized to 1200×480; animated ones are kept as uploaded.')}</p>
      </>
    ) },
    effect: { title: t('Profile effect'), body: (
      <div className="flex flex-wrap gap-2">
        {[{ id: '', label: t('None'), glyph: '' }, ...PROFILE_EFFECTS].map((e) => <button key={e.id || 'none'} type="button" onClick={() => set('effect')(e.id)} className={chip(d.effect === e.id)} data-effect-option={e.id || 'none'} aria-pressed={d.effect === e.id}>{e.glyph} {e.label}</button>)}
        <div className="w-full"><LayeredPicker kind="profile-effects" value={d.effect} onPick={set('effect')} /></div>
      </div>
    ) },
    frame: { title: t('Profile frame'), body: (
      <div className="flex flex-wrap gap-2">
        {[{ id: '', label: t('None') }, ...PROFILE_FRAMES].map((f) => <button key={f.id || 'none'} type="button" onClick={() => set('frame')(f.id)} className={chip(d.frame === f.id)} data-frame-option={f.id || 'none'} aria-pressed={d.frame === f.id}>{f.label}</button>)}
        <div className="w-full"><LayeredPicker kind="profile-frames" value={d.frame} onPick={set('frame')} /></div>
      </div>
    ) },
    tag: { title: t('Clan tag'), body: (
      <div className="space-y-3">
        <div><input className="input w-32 uppercase" value={d.clanTag} onChange={(e) => set('clanTag')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} maxLength={4} placeholder="TAG" data-clan-tag-input /><p className="text-xs text-text-2 mt-1">{t('2–4 letters or digits shown beside your name everywhere. Leave empty for none.')}</p></div>
        <WearServerTag />
      </div>
    ) },
    badges: { title: t('House badge'), body: <HousePicker /> },
  }
  const plateUser = { id: user.id, display_name: d.display, avatar_url: d.avatar }

  return (
    <div className="relative h-full min-h-0 flex text-[#dbdee1] max-lg:flex-col max-lg:overflow-y-auto" data-profile-editor>
      <aside className="w-72 shrink-0 border-r border-white/10 overflow-y-auto p-4 space-y-5 max-lg:w-full max-lg:border-r-0 max-lg:overflow-visible">
        <div className="relative">
          <button type="button" onClick={() => setWho((w) => !w)} className="flex items-center gap-1 text-lg font-bold hover:text-white" aria-expanded={who} data-profile-switch>{t('Main Profile')}<ChevronDown size={16} /></button>
          {who && (
            <div className="pop absolute left-0 top-full mt-1 z-20 w-64 rounded-xl bg-bg-1 border border-line shadow-2xl p-1.5" role="menu">
              <div className="px-2 py-1.5 text-sm font-semibold text-text-0">{t('Main Profile')}</div>
              {guilds.length > 0 && <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-text-2">{t('Server Profiles')}</div>}
              {guilds.map((g) => <button key={g.id} type="button" onClick={() => { setWho(false); openModal({ kind: 'serverProfile', guildId: g.id }) }} className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-text-1 hover:bg-bg-3" data-server-profile={g.id}>{g.name}</button>)}
            </div>
          )}
        </div>
        <div>
          <Heading>{t('Nameplate')}</Heading>
          <Tile section="nameplate" open={section} onOpen={setSection} label={t('Nameplate')} className={`w-full h-14 flex items-center gap-3 px-3 ${nameplateClass(d.plate)}`}>
            {isAssetNameplate(d.plate) && <NameplateVideo value={d.plate} />}
            <Avatar user={plateUser} size={32} /><span className="h-3 flex-1 rounded-full bg-white/25" />
          </Tile>
        </div>
        <div>
          <Heading>{t('Avatar & Decoration')}</Heading>
          <div className="grid grid-cols-2 gap-2">
            <Tile section="avatar" open={section} onOpen={setSection} label={t('Avatar')} className="aspect-square flex items-center justify-center"><Avatar user={plateUser} decoration="" size={72} /></Tile>
            <Tile section="decoration" open={section} onOpen={setSection} label={t('Avatar decoration')} className="aspect-square flex items-center justify-center"><Avatar user={plateUser} decoration={d.decoration} size={64} /></Tile>
          </div>
        </div>
        <div>
          <Heading>{t('Display Name Style')}</Heading>
          <button type="button" onClick={() => setStyleOpen(true)} className="w-full h-14 rounded-xl bg-black/25 border-2 border-transparent hover:border-white/40 px-3 text-left text-xl font-bold truncate" data-name-style-open data-name-style-card>
            <span className={look.className} style={look.style} data-name-preview>{d.display || user.display_name}</span>
          </button>
        </div>
        <div>
          <Heading>{t('Theme & Banner')}</Heading>
          <div className="grid grid-cols-2 gap-2">
            <Tile section="theme" open={section} onOpen={setSection} label={t('Profile theme')} className="aspect-square"><span className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${d.primary ?? base}, ${d.accent ?? d.primary ?? base})` }} /></Tile>
            <Tile section="banner" open={section} onOpen={setSection} label={t('Profile banner')} className="aspect-square flex items-center justify-center">{d.banner ? <img src={d.banner} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Camera size={22} className="text-text-2" />}</Tile>
          </div>
        </div>
        <div>
          <Heading>{t('Profile Effect & Frame')}</Heading>
          <div className="grid grid-cols-2 gap-2">
            <Tile section="effect" open={section} onOpen={setSection} label={t('Profile effect')} className="aspect-square flex items-center justify-center text-2xl">{PROFILE_EFFECTS.find((e) => e.id === d.effect)?.glyph ?? (effectItem && layeredThumb('profile-effects', effectItem) ? <img src={layeredThumb('profile-effects', effectItem)!} alt={effectItem.name} className="absolute inset-0 h-full w-full object-cover object-top" /> : <span className="text-sm text-text-2">{t('None')}</span>)}</Tile>
            <Tile section="frame" open={section} onOpen={setSection} label={t('Profile frame')} className="aspect-square flex items-center justify-center text-sm">{PROFILE_FRAMES.find((f) => f.id === d.frame)?.label ?? (frameItem ? <img src={layeredThumb('profile-frames', frameItem)!} alt={frameItem.name} className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] object-contain" /> : <span className="text-text-2">{t('None')}</span>)}</Tile>
          </div>
        </div>
        <div>
          <Heading>{t('Tags & Badges')}</Heading>
          <div className="grid grid-cols-2 gap-2">
            <Tile section="tag" open={section} onOpen={setSection} label={t('Clan tag')} className="h-14 flex items-center justify-center font-bold tracking-wide">{d.clanTag || <span className="text-sm font-normal text-text-2">{t('Clan tag')}</span>}</Tile>
            <Tile section="badges" open={section} onOpen={setSection} label={t('House badge')} className="h-14 flex items-center justify-center gap-2 text-sm">{user.house ? badgeIcon(`house_${user.house}`) : null}<span className="text-text-2">{t('Badges')}</span></Tile>
          </div>
        </div>
        <div>
          <Heading>{t('Who can see your full profile')}</Heading>
          <select className="input w-full" value={d.privacy} onChange={(e) => set('privacy')(e.target.value as 'everyone' | 'friends')} data-profile-privacy>
            <option value="everyone">{t('Everyone')}</option>
            <option value="friends">{t('Friends only')}</option>
          </select>
          <p className="mt-1 text-xs text-text-2">{t('Friends only hides your about me, banner, pronouns and panels from everyone else.')}</p>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto p-6 flex justify-center max-lg:overflow-visible">
        <div className="w-[340px] max-w-full">
          <ProfileCard edit={edit} user={draftUser} />
          <p className="mt-2 text-center text-xs text-[#b5bac1]">{t('Click your name, pronouns, status, avatar or banner to change them here.')}</p>
        </div>
      </main>

      <section className="w-[400px] shrink-0 border-l border-white/10 overflow-y-auto p-5 max-lg:w-full max-lg:border-l-0 max-lg:overflow-visible">
        <div className="flex gap-5 border-b border-white/10 mb-4" role="tablist">
          {([['about', t('About Me')], ['activity', t('Activity')], ['wishlist', t('Wishlist')], ['games', t('Games')]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`pb-2 text-[15px] font-semibold border-b-2 -mb-px ${tab === id ? 'border-white text-white' : 'border-transparent text-[#b5bac1] hover:text-white'}`} data-editor-tab={id}>{label}</button>
          ))}
        </div>
        {tab === 'about' && (
          <div>
            <div className="mb-1 flex gap-0.5" data-bio-toolbar>
              {FORMATS.map((f) => <button key={f.key} type="button" title={f.label} aria-label={f.label} onMouseDown={(e) => e.preventDefault()} onClick={() => { const el = bioRef.current; if (el) { el.focus(); set('bio')(toggleWrap(el, f)) } }} className="h-8 min-w-8 rounded-md px-2 text-sm text-text-1 hover:bg-bg-3 hover:text-text-0" data-bio-format={f.key}>{f.label}</button>)}
            </div>
            <textarea ref={bioRef} className="input resize-none text-[14px]" rows={8} maxLength={MAX_BIO} value={d.bio} onChange={(e) => set('bio')(e.target.value)} placeholder={t('Tell people a bit about yourself')} data-bio-input />
            <div className="flex justify-between text-[11px] text-text-2 mt-1"><span>{t('Select text and use the buttons above, or type **bold**, *italic*, __underline__, ~~strike~~ and links. The preview shows how it looks.')}</span><span>{d.bio.length}/{MAX_BIO}</span></div>
          </div>
        )}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'wishlist' && (
          <div><textarea className="input resize-none font-mono text-[13px]" rows={10} value={d.wishlist} onChange={(e) => set('wishlist')(e.target.value)} placeholder={t('One per line: Title | https://link (link optional)')} data-panel-wishlist /><p className="mt-1 text-xs text-text-2">{t('Optional sections on your profile card, up to 25 items each. Leave empty to hide.')}</p></div>
        )}
        {tab === 'games' && (
          <div><textarea className="input resize-none font-mono text-[13px]" rows={10} value={d.games} onChange={(e) => set('games')(e.target.value)} placeholder={t('One per line: Title | https://link (link optional)')} data-panel-games /><p className="mt-1 text-xs text-text-2">{t('Optional sections on your profile card, up to 25 items each. Leave empty to hide.')}</p></div>
        )}
      </section>

      {section && (
        <div className="absolute inset-y-0 left-72 right-0 z-10 flex items-start justify-center bg-black/40 p-6 max-lg:fixed max-lg:inset-0 max-lg:left-0 max-lg:items-end max-lg:p-0" onMouseDown={(e) => { if (e.target === e.currentTarget) setSection(null) }}>
          <div className="pop w-full max-w-xl max-h-full overflow-y-auto rounded-2xl bg-bg-1 border border-line shadow-2xl p-5 max-lg:max-h-[80vh] max-lg:rounded-b-none" role="dialog" data-editor-panel={section}>
            <div className="flex items-center mb-3"><h3 className="text-lg font-bold flex-1">{panel[section].title}</h3><button type="button" onClick={() => setSection(null)} className="rounded-md p-1 text-text-2 hover:text-text-0 hover:bg-bg-3" aria-label={t('Close')} data-editor-panel-close><X size={18} /></button></div>
            {panel[section].body}
          </div>
        </div>
      )}

      {dirty && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(640px,calc(100%-2rem))] rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in max-lg:fixed" data-editor-savebar>
          <span className="text-sm flex-1">{t('Careful — you have unsaved changes!')}</span>
          <button type="button" className="btn-ghost" onClick={reset}>{t('Reset')}</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !d.display.trim()} onClick={save}>{t('Save Changes')}</button>
        </div>
      )}
      <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('banner', f); e.target.value = '' }} data-banner-input />
      {styleOpen && <NameStyleModal onClose={() => setStyleOpen(false)} name={d.display || user.display_name} value={d.nameStyle} onApply={(v) => { set('nameStyle')(v); setStyleOpen(false) }} />}
    </div>
  )
}

/** Join a house for a badge on your profile, or none. Saves right away. */
function HousePicker() {
  const t = useT()
  const user = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const pick = async (house: string) => {
    try { const u = await api.patch<PrivateUser>('/users/@me', { house }); const st = useStore.getState(); if (st.token) st.setAuth(st.token, u) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const cur = user?.house ?? ''
  return (
    <div data-house-picker>
      <div className="grid gap-2 sm:grid-cols-3">
        {HOUSES.map((h) => (
          <button key={h.id} type="button" onClick={() => pick(cur === h.id ? '' : h.id)} aria-pressed={cur === h.id} className={`flex items-start gap-2 rounded-lg border p-2.5 text-left ${cur === h.id ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} data-house-option={h.id}>
            {badgeIcon(h.badge)}
            <span className="min-w-0"><span className="block text-sm font-semibold">{t(h.label)}</span><span className="block text-xs text-text-2">{t(h.desc)}</span></span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-text-2">{cur ? t('Click your house again to leave it.') : t('Optional: pick one for a badge on your profile.')}</p>
    </div>
  )
}

/** The activity shown under your name: set by hand here (Spotify, when linked, shows instead while it plays). */
function ActivityTab() {
  const t = useT()
  const user = useStore((s) => s.user)!
  const pushToast = useStore((s) => s.pushToast)
  const [type, setType] = useState<ManualActivity['type']>(user.custom_activity?.type ?? 'playing')
  const [name, setName] = useState(user.custom_activity?.name ?? '')
  const save = async (clear: boolean) => {
    try {
      if (clear) await api.delete('/users/@me/activity'); else await api.put('/users/@me/activity', { type, name: name.trim() })
      const u = await api.get<PrivateUser>('/users/@me'); const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
      if (clear) setName('')
      pushToast(clear ? t('Activity cleared') : t('Activity set'))
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="space-y-2" data-editor-activity>
      <div className="flex gap-2">
        <select className="input w-36 shrink-0" value={type} onChange={(e) => setType(e.target.value as ManualActivity['type'])} aria-label={t('Activity type')}>
          <option value="playing">{t('Playing')}</option><option value="watching">{t('Watching')}</option><option value="listening">{t('Listening to')}</option><option value="competing">{t('Competing in')}</option>
        </select>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} placeholder="Factorio" />
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost bg-bg-3" onClick={() => save(false)} disabled={!name.trim()}>{t('Set activity')}</button>
        {user.custom_activity && <button type="button" className="btn-ghost" onClick={() => save(true)}>{t('Clear activity')}</button>}
      </div>
      <p className="text-xs text-text-2">{user.share_activity === false ? t('Activity sharing is off in Data & Privacy, so nobody sees it.') : t("Shown under your name while Spotify isn't playing.")}</p>
    </div>
  )
}
