import { Camera, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import { colorFor, resizeImage } from '../../../lib/format'
import ImagePicker from '../ImagePicker'
import ProfileCard from '../../ProfileCard'
import { Toggle } from '../SettingsShell'
import { ROLE_COLORS } from '../../../lib/perms'
import { nameCss } from '../../StyledName'

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
  const [busy, setBusy] = useState(false)
  const bannerRef = useRef<HTMLInputElement>(null)
  if (!user) return null

  const dirty = display !== user.display_name || pronouns !== (user.pronouns ?? '') || bio !== user.bio
    || (avatar ?? null) !== (user.avatar_url ?? null) || (banner ?? null) !== (user.banner_url ?? null)
    || (primary ?? null) !== (user.theme_primary ?? null) || (accent ?? null) !== (user.theme_accent ?? null)
    || (namePrimary ?? null) !== (user.name_primary ?? null) || (nameAccent ?? null) !== (user.name_accent ?? null)
  const reset = () => { setDisplay(user.display_name); setPronouns(user.pronouns ?? ''); setBio(user.bio); setAvatar(user.avatar_url); setBanner(user.banner_url ?? null); setPrimary(user.theme_primary ?? null); setAccent(user.theme_accent ?? null); setNamePrimary(user.name_primary ?? null); setNameAccent(user.name_accent ?? null) }
  const save = async () => {
    setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', {
        display_name: display, pronouns, bio, avatar_url: avatar ?? '', banner_url: banner ?? '', theme_primary: primary ?? '', theme_accent: accent ?? '',
        name_primary: namePrimary ?? '', name_accent: namePrimary ? (nameAccent ?? '') : '',
      })
      if (token) setAuth(token, u)
      pushToast('Profile saved')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const pickBanner = async (f: File | undefined) => {
    if (!f) return
    try { setBanner(await resizeImage(f, 1200, 480, 900 * 1024)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const base = primary ?? colorFor(user.id)

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">Profiles</h1>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="flex-1 min-w-0 space-y-6">
          <div><label className="label">Display name</label><input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} required /></div>
          <div><label className="label">Pronouns</label><input className="input" value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder="Add your pronouns" /></div>
          <div>
            <label className="label">Avatar</label>
            <ImagePicker value={avatar} onChange={setAvatar} label={display} id={user.id} />
          </div>
          <div>
            <label className="label">Profile banner</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => bannerRef.current?.click()} className="group relative h-20 w-60 max-w-full overflow-hidden rounded-xl border-2 border-dashed border-line hover:border-accent flex items-center justify-center" style={{ background: banner ? undefined : 'rgba(0,0,0,0.25)' }}>
                {banner ? <img src={banner} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-text-2">Upload banner</span>}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white"><Camera size={22} /></span>
              </button>
              <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickBanner(e.target.files?.[0]); e.target.value = '' }} />
              {banner && <button type="button" onClick={() => setBanner(null)} className="text-text-2 hover:text-danger" title="Remove banner"><Trash2 size={18} /></button>}
            </div>
            <p className="text-xs text-text-2 mt-1">Without a banner the card shows your theme colour. Images are resized to 1200×480.</p>
          </div>
          <div className="space-y-4 rounded-xl bg-bg-0/40 border border-line p-4">
            <ColorField label="Theme colour" value={primary} onChange={setPrimary} allowClear base={base} />
            <Toggle label="Gradient (add a second colour)" checked={accent !== null} onChange={(v) => setAccent(v ? (accent ?? '#6d5dfc') : null)} />
            {accent !== null && <ColorField label="Second colour" value={accent} onChange={(v) => setAccent(v ?? '#6d5dfc')} allowClear={false} base={base} />}
          </div>
          <div className="space-y-4 rounded-xl bg-bg-0/40 border border-line p-4">
            <div className="text-sm text-text-2">How your name appears in chat, DMs and lists. Inside a server a coloured role takes over.</div>
            <ColorField label="Name colour" value={namePrimary} onChange={(v) => { setNamePrimary(v); if (!v) setNameAccent(null) }} allowClear base="#f2f3f7" />
            {namePrimary && <Toggle label="Gradient name (add a second colour)" checked={nameAccent !== null} onChange={(v) => setNameAccent(v ? (nameAccent ?? '#6d5dfc') : null)} />}
            {namePrimary && nameAccent !== null && <ColorField label="Second colour" value={nameAccent} onChange={(v) => setNameAccent(v ?? '#6d5dfc')} allowClear={false} base="#6d5dfc" />}
            <div className="text-sm">Preview: <span className="text-[15px] font-semibold" style={nameCss(namePrimary, nameAccent)}>{display || user.display_name}</span> <span className="text-text-2 text-xs">Today at 9:41 AM</span></div>
          </div>
          <div>
            <label className="label">About me</label>
            <textarea className="input resize-none font-mono text-[13px]" rows={5} maxLength={MAX_BIO} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people a bit about yourself" />
            <div className="flex justify-between text-[11px] text-text-2 mt-1"><span>Supports **bold**, *italic*, __underline__, ~~strike~~, `code`, &gt; quotes and links.</span><span>{bio.length}/{MAX_BIO}</span></div>
          </div>
        </div>
        <div className="w-[340px] max-lg:w-full shrink-0">
          <div className="label">Preview</div>
          <ProfileCard user={{ ...user, display_name: display || user.display_name, pronouns, bio, avatar_url: avatar, banner_url: banner, theme_primary: primary, theme_accent: accent, name_primary: namePrimary, name_accent: nameAccent }} />
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
