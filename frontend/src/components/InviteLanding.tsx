import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CropImg from './CropImg'
import { api } from '../lib/api'
import { colorFor, formatTime, initials } from '../lib/format'
import { splashBackground } from '../lib/splash'
import { useT } from '../lib/i18n'

export interface AnonPreview {
  code: string
  guild: { id: string; name: string; icon_url: string | null; member_count: number; online_count: number; description?: string; splash_url?: string | null; rules_required?: boolean }
  expired: boolean
  paused: boolean
  preview_channel: { id: string; name: string } | null
}
interface PeekMessage { id: string; content: string; created_at: string; author: { display_name: string; avatar_url: string | null } }

export const AUTOJOIN_KEY = 'parley.invite.autojoin'

/** What a logged-out visitor sees at /invite/<code>: the server, its counts, two ways in, and (if the owner allows) a read-only peek. */
export default function InviteLanding({ code, preview: p, returnTo }: { code: string; preview: AnonPreview; returnTo: string }) {
  const t = useT()
  // A stale key (an abandoned sign-up) must not auto-join a later visit: only a click in this visit sets it.
  useEffect(() => { try { sessionStorage.removeItem(AUTOJOIN_KEY) } catch { /* private mode */ } }, [])
  const [peek, setPeek] = useState<PeekMessage[]>([])
  useEffect(() => {
    setPeek([])
    if (!p.preview_channel) return
    let live = true
    api.get<PeekMessage[]>(`/invites/${code}/preview-messages`).then((m) => { if (live) setPeek(m) }).catch(() => {})
    return () => { live = false }
  }, [code, p.preview_channel])
  const remember = () => { try { sessionStorage.setItem(AUTOJOIN_KEY, code) } catch { /* private mode */ } }
  const state = { from: returnTo }
  return (
    <div className="relative h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 bg-cover bg-center p-4" style={p.guild.splash_url ? { backgroundImage: splashBackground(p.guild.splash_url) } : undefined} data-invite-splash={p.guild.splash_url ? '1' : '0'}>
      <div className="pop w-full max-w-3xl rounded-2xl bg-bg-1 border border-line p-6 sm:p-8 shadow-2xl flex flex-col sm:flex-row gap-6 sm:items-start" data-invite-landing>
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="h-14 w-14 rounded-2xl overflow-hidden flex items-center justify-center text-2xl font-bold text-white" style={{ background: p.guild.icon_url ? undefined : colorFor(p.guild.id) }}>
            {p.guild.icon_url ? <CropImg src={p.guild.icon_url} className="h-full w-full object-cover" alt="" /> : initials(p.guild.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold break-words">{p.guild.name}</h1>
            <p className="text-text-2 text-sm">{t("You've been invited to join")}</p>
          </div>
          {p.guild.description && <p className="text-sm text-text-1 whitespace-pre-wrap break-words">{p.guild.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-1">
            <span className="inline-flex items-center gap-1.5" data-invite-online><span className="h-2 w-2 rounded-full bg-green-500" />{t('{n} online', { n: p.guild.online_count })}</span>
            <span data-invite-members>{p.guild.member_count === 1 ? t('1 member') : t('{n} members', { n: p.guild.member_count })}</span>
          </div>
          {p.expired ? <p className="text-danger text-sm">{t('This invite has expired.')}</p>
            : p.paused ? <p className="text-warn text-sm" data-invite-paused>{t('This server has paused new members for now. Try again later.')}</p>
            : (
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Link to="/register" state={state} onClick={remember} className="btn-primary" data-invite-join>{t('Join the conversation')}</Link>
                <Link to="/login" state={state} onClick={remember} className="btn-ghost border border-line" data-invite-login>{t('I have an account')}</Link>
              </div>
            )}
        </div>
        {p.preview_channel && peek.length > 0 && (
          <div className="flex-1 min-w-0 rounded-xl border border-line bg-bg-0 p-3.5 flex flex-col gap-2.5" data-invite-peek>
            <div className="flex justify-between gap-2 text-xs text-text-2"><span className="truncate"># {p.preview_channel.name}</span><span className="shrink-0">{t('read-only preview')}</span></div>
            {peek.map((m) => (
              <div key={m.id} className="flex gap-2.5 text-sm">
                <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold text-white" style={{ background: m.author.avatar_url ? undefined : colorFor(m.author.display_name) }}>
                  {m.author.avatar_url ? <CropImg src={m.author.avatar_url} className="h-full w-full object-cover" alt="" /> : initials(m.author.display_name)}
                </div>
                <div className="min-w-0">
                  <div><span className="font-semibold text-[13px]">{m.author.display_name}</span><time className="ml-1.5 text-[11px] text-text-2">{formatTime(m.created_at)}</time></div>
                  <p className="text-text-1 whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
