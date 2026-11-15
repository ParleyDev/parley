import { APP_NAME } from '../lib/brand'
import CropImg from '../components/CropImg'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import InviteLanding, { AUTOJOIN_KEY, type AnonPreview } from '../components/InviteLanding'
import { renderMarkdown } from '../lib/markdown'
import { useStore } from '../store'
import { nameOf } from '../lib/dm'
import type { Channel, DmChannel, Guild } from '../lib/types'
import { colorFor, initials } from '../lib/format'
import { markJoined } from '../lib/welcome'
import { splashBackground } from '../lib/splash'
import { useT } from '../lib/i18n'
import { inviteTarget, resolveInviteLanding } from '../lib/invites'

interface GroupPreview { code: string; channel_id: string; name: string; icon_url: string | null; already_member: boolean; full: boolean; members: { id: string; display_name: string; avatar_url: string | null }[] }
interface Preview { code: string; guild: { id: string; name: string; icon_url: string | null; member_count: number; rules?: string; rules_required?: boolean; splash_url?: string | null; description?: string }; expired: boolean; already_member: boolean; banned: boolean; paused?: boolean }

export default function InvitePage() {
  const t = useT()
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const token = useStore((s) => s.token)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const notes = useStore((s) => s.notes)
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [group, setGroup] = useState<GroupPreview | null>(null)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const [busy, setBusy] = useState(false)

  const [anon, setAnon] = useState<AnonPreview | null>(null)
  const returnTo = location.pathname + location.search

  const say = (e: unknown) => e instanceof ApiError && e.status === 429 ? t('Too many requests. Try again in a minute.') : (e as Error).message

  // An already-member's way in: the community the link names, else the server as the app last had it.
  const landIn = async (guildId: string, replace = false) => {
    const to = inviteTarget(location.search)
    navigate(to ? await resolveInviteLanding(guildId, to, null) : `/channels/${guildId}`, { replace })
  }

  const join = async () => {
    setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>(`/invites/${code}`)
      upsertGuild(g); markJoined(g.id)
      navigate(await resolveInviteLanding(g.id, inviteTarget(location.search), g.channels.find((c) => c.kind === 'text')?.id ?? null), { replace: true })
    } catch (e) { setErr(say(e)) } finally { setBusy(false) }
  }

  useEffect(() => {
    // With a session: server invite first, then group DM invite (they share the /invite/ path). Logged out, a group
    // code cannot be told from an unknown one, so a miss shows the not-found message with a way to log in.
    const fail = (e: unknown) => {
      if (!token || (e instanceof ApiError && e.status === 429)) { setErr(say(e)); return }
      api.get<GroupPreview>(`/group-invites/${code}`).then(setGroup).catch((g) => setErr(say(g instanceof ApiError && g.status === 429 ? g : e)))
    }
    if (!token) { api.get<AnonPreview>(`/invites/${code}`).then(setAnon).catch(fail); return }
    api.get<Preview>(`/invites/${code}`).then((pv) => {
      setP(pv)
      // Coming back from the landing's sign-up or sign-in: join without another click, unless something needs the visitor first.
      let want = false
      try { want = sessionStorage.getItem(AUTOJOIN_KEY) === code; sessionStorage.removeItem(AUTOJOIN_KEY) } catch { /* private mode */ }
      if (want && pv.already_member) { void landIn(pv.guild.id, true); return }
      if (want && !pv.already_member && !pv.banned && !pv.paused && !pv.expired && !pv.guild.rules_required) void join()
    }).catch(fail)
    // Runs once per code and session: say/join are recreated every render and must not re-trigger the fetch (or a second autojoin).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token])

  if (anon && !token) return <InviteLanding code={code} preview={anon} returnTo={returnTo} />
  return (
    <div className="relative h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 bg-cover bg-center p-4" style={p?.guild.splash_url ? { backgroundImage: splashBackground(p.guild.splash_url) } : undefined} data-invite-splash={p?.guild.splash_url ? '1' : '0'}>
      <div className="pop w-full max-w-sm rounded-2xl bg-bg-1 border border-line p-8 text-center shadow-2xl">
        {group ? (
          <div data-group-invite-page>
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full text-2xl font-bold text-white" style={{ background: group.icon_url ? undefined : colorFor(group.channel_id) }}>
              {group.icon_url ? <CropImg src={group.icon_url} className="h-full w-full object-cover" alt="" /> : initials(group.name || group.members.map((m) => nameOf(m, notes)).join(', '))}
            </div>
            <p className="text-text-2 text-sm">{t("You've been invited to join a group")}</p>
            <h1 className="text-2xl font-bold mb-1" data-group-invite-name>{group.name || group.members.map((m) => nameOf(m, notes)).join(', ')}</h1>
            <p className="text-text-2 text-sm mb-6">{group.members.length === 1 ? t('1 member') : t('{n} members', { n: group.members.length })}</p>
            {err && <p className="mb-3 text-sm text-danger">{err}</p>}
            {group.already_member ? <button className="btn-primary w-full" onClick={() => navigate(`/channels/@me/${group.channel_id}`)}>{t('Open group')}</button>
              : group.full ? <p className="text-danger text-sm">{t('This group is full.')}</p>
              : <button className="btn-primary w-full" disabled={busy} data-group-invite-join onClick={async () => { setBusy(true); try { const c = await api.post<DmChannel>(`/group-invites/${code}`); upsertChannel(c); navigate(`/channels/@me/${c.id}`, { replace: true }) } catch (e) { setErr(say(e)) } finally { setBusy(false) } }}>{busy ? t('Joining…') : t('Join Group')}</button>}
          </div>
        ) : err ? (
          <>
            <h1 className="text-xl font-bold mb-2">{t('Invite invalid')}</h1>
            <p className="text-text-2 text-sm mb-6">{err}</p>
            <button className="btn-primary w-full" onClick={() => navigate(token ? '/channels/@me' : '/login', token ? undefined : { state: { from: returnTo } })}>{t('Continue to {app}', { app: APP_NAME })}</button>
            {!token && <p className="mt-4 text-xs text-text-2">{t('Have an invite to a group chat?')} <Link to="/login" state={{ from: returnTo }} className="text-sky-400 hover:underline" data-invite-group-login>{t('Log in to open it.')}</Link></p>}
          </>
        ) : !p ? (
          <p className="text-text-2">{t('Loading…')}</p>
        ) : (
          <>
            <div className="mx-auto mb-4 h-20 w-20 rounded-3xl overflow-hidden flex items-center justify-center text-2xl font-bold text-white" style={{ background: p.guild.icon_url ? undefined : colorFor(p.guild.id) }}>
              {p.guild.icon_url ? <CropImg src={p.guild.icon_url} className="h-full w-full object-cover" alt="" /> : initials(p.guild.name)}
            </div>
            <p className="text-text-2 text-sm">{t("You've been invited to join")}</p>
            <h1 className="text-2xl font-bold mb-1">{p.guild.name}</h1>
            <p className="text-text-2 text-sm mb-6">{p.guild.member_count === 1 ? t('1 member') : t('{n} members', { n: p.guild.member_count })}</p>
            {p.guild.rules && (
              <div className="mb-6 rounded-xl border border-line bg-bg-1 p-3 text-left" data-invite-rules>
                <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-1">{t('Server rules')}{p.guild.rules_required ? ` · ${t('you will be asked to accept these')}` : ''}</div>
                <div className="msg-content text-sm text-text-1 max-h-40 overflow-y-auto">{renderMarkdown(p.guild.rules)}</div>
              </div>
            )}
            {p.already_member ? (
              <button className="btn-primary w-full" disabled={busy} onClick={async () => { setBusy(true); try { await landIn(p.guild.id) } finally { setBusy(false) } }}>{busy ? t('Opening…') : t('Open server')}</button>
            ) : p.banned ? (
              <p className="text-danger text-sm">{t('You are banned from this server.')}</p>
            ) : p.expired ? (
              <p className="text-danger text-sm">{t('This invite has expired.')}</p>
            ) : p.paused ? (
              <p className="text-warn text-sm" data-invite-paused>{t('This server has paused new members for now. Try again later.')}</p>
            ) : (
              <button className="btn-primary w-full" disabled={busy} onClick={join}>{busy ? t('Joining…') : t('Accept Invite')}</button>
            )}
            {/* Installed desktop apps register parley:// and open the invite on their server. */}
            {!/ParleyDesktop\//.test(navigator.userAgent) && !p.expired && <a href={`parley://invite/${encodeURIComponent(code ?? '')}`} className="mt-3 block text-center text-xs text-text-2 hover:text-text-0 hover:underline" data-invite-open-app>{t('Open in the desktop app')}</a>}
          </>
        )}
      </div>
    </div>
  )
}
