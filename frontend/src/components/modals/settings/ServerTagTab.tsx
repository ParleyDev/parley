import { ChevronDown, Info } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../lib/api'
import { tn, useT } from '../../../lib/i18n'
import type { Guild } from '../../../lib/types'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'
import { TagPill } from '../../Flair'

/** Badges to pick from (the first row shows until "Show all badges"). */
const BADGES = ['🌿', '⚔️', '💖', '🔥', '💧', '💀', '🌙', '⚡', '💎', '🍄', '⭐', '👑', '🎮', '🎵', '🎨', '🐸', '🐱', '🦊', '🐉', '🌸', '🍀', '☕', '🚀', '🛡️', '🏆', '🎯', '🧪', '📚', '🌈', '❄️']
const COLORS = ['#e05a7a', '#e0884a', '#d9b43c', '#4cb38a', '#3fa7d6', '#6b7be0', '#9b6be0', '#c86bd6', '#e06b9b', '#b07a4f', '#7a8a6a', '#5f8fa8', '#8a8f98', '#c0c4cc']

/**
 * Server Settings › Server Tag (Discord's page, without boosting): a 2-4 character name, a badge and a colour, with
 * a live chat preview. Members wear it next to their name; anyone who sees it can open the server's card.
 */
export default function ServerTagTab({ guildId, onTab }: { guildId: string; onTab: (t: 'overview' | 'applications') => void }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const me = useStore((s) => s.user)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [tag, setTag] = useState(guild?.tag ?? '')
  const [badge, setBadge] = useState(guild?.tag_badge ?? BADGES[1])
  const [color, setColor] = useState(guild?.tag_color ?? '')
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!guild || !me) return null
  const dirty = tag !== (guild.tag ?? '') || (!!tag && (badge !== (guild.tag_badge ?? BADGES[1]) || color !== (guild.tag_color ?? '')))
  const save = async (next: { tag: string | null; badge: string; color: string }) => {
    setBusy(true)
    try {
      const g = await api.put<Guild>(`/guilds/${guild.id}/tag`, { tag: next.tag, badge: next.badge, color: next.color || null })
      upsertGuild(g); setTag(g.tag ?? ''); setBadge(g.tag_badge ?? BADGES[1]); setColor(g.tag_color ?? '')
      pushToast(next.tag ? t('Server tag saved') : t('Server tag removed'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const reset = () => { setTag(guild.tag ?? ''); setBadge(guild.tag_badge ?? BADGES[1]); setColor(guild.tag_color ?? '') }
  const shown = tag || 'TAG'
  const link = 'text-[#00a8fc] hover:underline'
  const people = [
    { name: 'Roka', text: t('anyone down for a game?'), hue: '#e0884a' },
    { name: 'hongo', text: t('count me in'), hue: '#4cb38a' },
    { me: true, text: t('check out my tag!') },
    { name: 'sharon', text: t('woah how did you get that'), hue: '#6b7be0' },
    { me: true, text: t('anyone here can get it!') },
  ]

  return (
    <div className="flex gap-8 max-lg:flex-col pb-20" data-server-tag-page>
      <div className="flex-1 min-w-0 max-w-[340px] max-lg:max-w-none space-y-6">
        <div>
          <h1 className="text-xl font-bold mb-3">{t('Server Tag')}</h1>
          <p className="text-sm text-text-1 leading-5">
            {tn('Create a tag that your server members can display next to their name! Anyone outside your server can view your {profile} through the Server Tag, and if applications are enabled, they can {apply}.', {
              profile: <button type="button" className={link} onClick={() => onTab('overview')}>{t('Server Profile')}</button>,
              apply: <button type="button" className={link} onClick={() => onTab('applications')}>{t('apply to join')}</button>,
            })}
          </p>
        </div>
        <section>
          <h2 className="text-base font-semibold mb-2">{t('Choose Name')}</h2>
          <div className="flex items-center gap-3">
            <label className="h-16 w-[150px] shrink-0 rounded-lg bg-bg-0 border border-line flex items-center gap-2 px-3 focus-within:border-accent">
              <span className="text-2xl leading-none">{badge}</span>
              <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="TAG" maxLength={4} aria-label={t('Tag name')}
                className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-wide outline-none placeholder:text-text-2/50" data-server-tag-input />
            </label>
            <p className="text-xs text-text-2">{t('You may use 2-4 characters: letters and numbers.')}</p>
          </div>
          <div className="mt-3 flex gap-2 rounded-lg border border-accent/50 bg-accent/10 p-3 text-xs text-text-1">
            <Info size={16} className="shrink-0 text-accent" />
            <span>{t("Changing your Server Tag changes it for every member wearing it. Removing it takes it off everyone's profile.")}</span>
          </div>
        </section>
        <section>
          <h2 className="text-base font-semibold">{t('Choose Badge')}</h2>
          <p className="text-xs text-text-2 mb-2">{t('Changing just the badge keeps the tag on everyone wearing it.')}</p>
          <div className="relative">
            <div className={`grid grid-cols-5 gap-2 ${all ? '' : 'max-h-[136px] overflow-hidden'}`}>
              {BADGES.map((b) => (
                <button key={b} type="button" onClick={() => setBadge(b)} aria-pressed={badge === b} title={b}
                  className={`h-[60px] rounded-lg text-2xl flex items-center justify-center bg-bg-0 border transition ${badge === b ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-text-2'}`} data-tag-badge-option={b}>{b}</button>
              ))}
            </div>
            {!all && (
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-1 to-transparent flex items-end justify-center">
                <button type="button" onClick={() => setAll(true)} className="mb-1 flex items-center gap-1 text-sm text-text-1 hover:text-text-0" data-tag-show-all>{t('Show all badges')}<ChevronDown size={16} /></button>
              </div>
            )}
          </div>
          <input value={badge} onChange={(e) => setBadge([...e.target.value].slice(0, 2).join(''))} className="input mt-2 w-40 text-sm" placeholder={t('Or type any emoji')} aria-label={t('Custom badge')} data-server-tag-badge />
        </section>
        <section>
          <h2 className="text-base font-semibold mb-2">{t('Choose Color')}</h2>
          <div className="grid grid-cols-5 gap-2">
            <button type="button" onClick={() => setColor('')} aria-pressed={!color} title={t('Default')}
              className={`h-[60px] rounded-lg bg-bg-0 border flex items-center justify-center ${!color ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-text-2'}`} data-tag-color-option=""><TagPill tag={shown} badge={badge} /></button>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-pressed={color === c} title={c}
                className={`h-[60px] rounded-lg bg-bg-0 border flex items-center justify-center ${color === c ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-text-2'}`} data-tag-color-option={c}><TagPill tag={shown} badge={badge} color={c} /></button>
            ))}
          </div>
        </section>
        {guild.tag && (
          <button type="button" className="btn-danger" disabled={busy} onClick={() => save({ tag: null, badge, color })} data-server-tag-remove>{t('Remove Server Tag')}</button>
        )}
      </div>

      <div className="w-[300px] max-lg:w-full shrink-0">
        <div className="lg:sticky lg:top-0 rounded-lg bg-bg-0 border border-line p-3 space-y-3" data-server-tag-preview>
          {people.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.me ? '' : 'opacity-50'}`}>
              {m.me ? <Avatar user={me} size={40} /> : <span className="h-10 w-10 shrink-0 rounded-full" style={{ background: m.hue }} />}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[15px] font-semibold" style={m.me ? undefined : { color: m.hue }}>
                  <span className="truncate">{m.me ? me.display_name : m.name}</span>
                  {m.me && tag.length >= 2 && <TagPill tag={tag} badge={badge} color={color || null} />}
                </div>
                <div className="text-sm text-text-1">{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {dirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-[calc(50%+116px)] z-10 w-[min(700px,calc(100vw-32px))] rounded-lg bg-bg-0 shadow-2xl border border-line px-4 py-2.5 flex items-center gap-3 pop" data-server-tag-savebar>
          <span className="flex-1 text-sm font-medium">{t('Careful — you have unsaved changes!')}</span>
          <button type="button" className="text-sm hover:underline" onClick={reset}>{t('Reset')}</button>
          <button type="button" className="btn-primary py-1.5 bg-success hover:bg-success/90" disabled={busy || (!!tag && tag.length < 2)} onClick={() => save({ tag: tag || null, badge, color })} data-server-tag-save>{t('Save Changes')}</button>
        </div>
      )}
    </div>
  )
}
