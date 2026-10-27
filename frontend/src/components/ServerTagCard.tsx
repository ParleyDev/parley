import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { colorFor, initials } from '../lib/format'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import { TagPill } from './Flair'

interface TagCardData {
  id: string; name: string; icon_url: string | null; banner_url: string | null; description: string
  tag: string | null; tag_badge: string | null; tag_color: string | null; created_at: string
  member_count: number; online_count: number; member: boolean; join: 'apply' | 'join' | null
}

/**
 * The server behind someone's server tag (Discord's server profile card): banner, icon, name, tag, description,
 * how many are online and in it, and a way in: go there if you're a member, else apply or join when it allows it.
 */
export default function ServerTagCard({ guildId, anchor, onClose }: { guildId: string; anchor: DOMRect; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const pushToast = useStore((s) => s.pushToast)
  const [card, setCard] = useState<TagCardData | null | 'gone'>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })
  useEffect(() => { api.get<TagCardData>(`/guilds/${guildId}/tag-card`).then(setCard).catch(() => setCard('gone')) }, [guildId])
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8))
    const top = anchor.bottom + 6 + r.height > window.innerHeight - 8 ? Math.max(8, anchor.top - r.height - 6) : anchor.bottom + 6
    setPos({ left, top })
  }, [anchor, card])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const go = () => { onClose(); navigate(`/channels/${guildId}`) }
  const join = async () => {
    setBusy(true)
    try { await api.post(`/guilds/${guildId}/tag-join`); go() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const c = card && card !== 'gone' ? card : null
  const since = c ? new Date(c.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' }) : ''

  return createPortal(
    <>
      <div className="fixed inset-0 z-[120]" onMouseDown={(e) => { e.stopPropagation(); onClose() }} />
      <div ref={ref} role="dialog" aria-label={c?.name ?? t('Server')} className="pop fixed z-[130] w-[300px] overflow-hidden rounded-xl bg-[#232428] border border-white/10 shadow-2xl text-[#dbdee1]" style={pos}
        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} data-server-tag-card={guildId}>
        {card === null && <div className="p-4 text-sm text-text-2">{t('Loading…')}</div>}
        {card === 'gone' && <div className="p-4 text-sm text-text-2" data-server-tag-card-gone>{t('This server is not available.')}</div>}
        {c && (
          <>
            <div className="h-[72px] bg-cover bg-center" style={c.banner_url ? { backgroundImage: `url(${c.banner_url})` } : { background: `linear-gradient(135deg, ${colorFor(c.id)}, #1e1f22)` }} />
            <div className="px-4 -mt-7">
              <div className="h-14 w-14 rounded-2xl overflow-hidden ring-[5px] ring-[#232428] flex items-center justify-center text-white font-bold" style={{ background: c.icon_url ? undefined : colorFor(c.id) }}>
                {c.icon_url ? <img src={c.icon_url} alt="" className="h-full w-full object-cover" /> : initials(c.name)}
              </div>
            </div>
            <div className="px-4 pt-2 pb-4 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg font-bold truncate" data-server-tag-card-name>{c.name}</span>
                {c.tag && <TagPill tag={c.tag} badge={c.tag_badge} color={c.tag_color} />}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />{t('{n} Online', { n: c.online_count })}</span>
                <span className="flex items-center gap-1" data-server-tag-card-members={c.member_count}><span className="h-2 w-2 rounded-full bg-text-2" />{c.member_count === 1 ? t('{n} Member', { n: 1 }) : t('{n} Members', { n: c.member_count })}</span>
                <span>{t('Est. {date}', { date: since })}</span>
              </div>
              {c.description && <p className="text-sm text-text-1 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{c.description}</p>}
              {c.member
                ? <button type="button" onClick={go} className="btn-primary w-full justify-center" data-server-tag-go>{t('Go to Server')}</button>
                : c.join === 'apply'
                  ? <button type="button" onClick={join} disabled={busy} className="btn-primary w-full justify-center" data-server-tag-join="apply">{t('Apply to Join')}</button>
                  : c.join === 'join'
                    ? <button type="button" onClick={join} disabled={busy} className="btn-primary w-full justify-center bg-success hover:bg-success/90" data-server-tag-join="join">{t('Join Server')}</button>
                    : <p className="text-xs text-text-2" data-server-tag-invite-only>{t('This server is invite only.')}</p>}
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
