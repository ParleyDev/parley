import { Gamepad2, LogOut, Maximize2, Rocket, Scissors } from 'lucide-react'
import { usePrefs } from '../lib/prefs'
import { saveClip } from '../lib/clips'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { leaveActivity, onSessionEvent, startActivity, useActivities, useCallActivities, type CallActivity, type CatalogEntry } from '../lib/activities'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import Avatar from './Avatar'
import { ControlButton } from './CallControls'

/** Built-ins' names and blurbs in the user's language (apps name themselves). */
function builtinText(t: ReturnType<typeof useT>, key: string, name: string, description = ''): [string, string] {
  if (key === 'watch') return [t('Watch Together'), t('Watch YouTube together, in sync.')]
  if (key === 'tictactoe') return [t('Tic-Tac-Toe'), t('Two players take X and O; everyone else watches.')]
  return [name, description]
}

/** The call bar's Activities button: pick something to start (or join) in this call. */
export function ActivitiesButton({ channelId }: { channelId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  useEffect(() => { if (open && !catalog) api.get<CatalogEntry[]>(`/channels/${channelId}/activities/catalog`).then(setCatalog).catch(() => setCatalog([])) }, [open, catalog, channelId])
  const start = async (key: string) => { setOpen(false); try { await startActivity(channelId, key) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <span className="relative flex">
      <ControlButton label={t('Activities')} on={open} onClick={() => setOpen((o) => !o)} data-activities-toggle=""><Rocket size={20} /></ControlButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-[340px] max-w-[calc(100vw-16px)] rounded-xl bg-bg-1 border border-line shadow-2xl p-3" data-activity-launcher>
            <div className="font-bold text-sm mb-2">{t('Activities')}</div>
            {catalog === null ? <p className="text-sm text-text-2">{t('Loading…')}</p> : (
              <div className="grid gap-1.5 max-h-80 overflow-y-auto">
                {catalog.map((c) => (
                  <button key={c.key} type="button" onClick={() => start(c.key)} className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-bg-3" data-activity-key={c.key}>
                    {c.icon_url ? <img src={c.icon_url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-accent/20 text-accent flex items-center justify-center"><Gamepad2 size={20} /></span>}
                    <span className="min-w-0"><span className="block font-semibold text-sm truncate">{builtinText(t, c.key, c.name)[0]}</span><span className="block text-xs text-text-2 line-clamp-2">{builtinText(t, c.key, c.name, c.description)[1]}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </span>
  )
}

/** Save a clip (only while Clips are on, Settings → Clips). */
export function ClipButton() {
  const on = usePrefs().clips
  if (!on) return null
  return <ControlButton label="Save Clip" onClick={() => { void saveClip() }} data-clip-save=""><Scissors size={20} /></ControlButton>
}

/** Activities running in the call that you aren't in: who's playing, and Join. */
export function ActivityChips({ channelId, inCall }: { channelId: string; inCall: boolean }) {
  const t = useT()
  const list = useCallActivities(channelId)
  const open = useActivities((s) => s.open)
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  const shown = list.filter((a) => a.id !== open)
  if (shown.length === 0) return null
  return (
    <div className="shrink-0 flex flex-wrap gap-2" data-activity-chips>
      {shown.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-lg bg-bg-2 border border-line pl-2 pr-1 py-1" data-activity-chip={a.key}>
          <Gamepad2 size={16} className="text-accent" />
          <span className="text-sm font-semibold">{builtinText(t, a.key, a.name)[0]}</span>
          <span className="flex -space-x-1.5">{a.participants.slice(0, 4).map((id) => <span key={id} className="rounded-full ring-2 ring-bg-2"><Avatar user={{ id, display_name: users[id]?.display_name ?? '', avatar_url: users[id]?.avatar_url ?? null }} size={18} /></span>)}</span>
          {inCall && <button type="button" onClick={() => startActivity(channelId, a.key).catch((e) => pushToast((e as Error).message, 'error'))} className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-white hover:brightness-110" data-activity-join={a.key}>{t('Join')}</button>}
        </div>
      ))}
    </div>
  )
}

type Msg = { parley?: number; id?: number; cmd?: string; args?: Record<string, unknown> }

/**
 * The open activity: its page in a frame, and the SDK bridge. Only the frame's own window is listened to. Built-ins
 * are our own pages (Watch Together needs its origin for the YouTube player); apps run on their own origin.
 */
export function ActivityFrame({ session }: { session: CallActivity }) {
  const t = useT()
  const ref = useRef<HTMLIFrameElement>(null)
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const guildId = useStore((s) => s.channels[session.channel_id]?.guild_id ?? null)
  const [ask, setAsk] = useState<{ scope: string; done: (ok: boolean) => void } | null>(null)
  const builtin = !session.app_id
  const target = useMemo(() => { try { return builtin ? '*' : new URL(session.url, location.href).origin } catch { return '*' } }, [builtin, session.url])
  const people = useMemo(() => session.participants.map((id) => { const u = id === me?.id ? me : users[id]; return { id, username: u?.username ?? '', display_name: u?.display_name ?? '', avatar_url: u?.avatar_url ?? null } }), [session.participants, users, me])
  const peopleRef = useRef(people); peopleRef.current = people
  const ready = useRef(false)
  const post = (m: Record<string, unknown>) => ref.current?.contentWindow?.postMessage({ parley: 1, ...m }, target)

  useEffect(() => {
    ready.current = false
    const onMsg = async (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const m = e.data as Msg
      if (!m || m.parley !== 1 || typeof m.cmd !== 'string') return
      const reply = (result: unknown, error?: string) => post({ id: m.id, result, error })
      try {
        switch (m.cmd) {
          case 'ready': {
            const s = await api.get<CallActivity & { state: unknown }>(`/activities/${session.id}`)
            ready.current = true
            const u = useStore.getState().user
            reply({ instance_id: session.id, channel_id: session.channel_id, guild_id: guildId, user: u && { id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null }, participants: peopleRef.current, state: s.state })
            break
          }
          case 'getParticipants': reply(peopleRef.current); break
          case 'setState': await api.put(`/activities/${session.id}/state`, { state: m.args?.state }); reply(true); break
          case 'sendMessage': await api.post(`/activities/${session.id}/messages`, { data: m.args?.data }); reply(true); break
          case 'authorize': {
            const scope = typeof m.args?.scope === 'string' ? m.args.scope : 'identify'
            const ok = await new Promise<boolean>((done) => setAsk({ scope, done }))
            setAsk(null)
            if (!ok) { reply(null, 'The user declined'); break }
            reply(await api.post(`/activities/${session.id}/authorize`, { scope }))
            break
          }
          case 'openExternal': {
            const url = String(m.args?.url ?? '')
            ;(window as unknown as { __parleyOpenLink?: (u: string) => void }).__parleyOpenLink?.(url)
            reply(true); break
          }
          case 'close': reply(true); void leaveActivity(session.id); break
          default: reply(null, `Unknown command: ${m.cmd}`)
        }
      } catch (err) { reply(null, (err as Error).message) }
    }
    window.addEventListener('message', onMsg)
    const off = onSessionEvent((ev) => { if (ev.id === session.id && ready.current) post({ evt: ev.t, data: ev.t === 'state' ? { state: ev.data, user_id: ev.user_id } : { data: ev.data, user_id: ev.user_id } }) })
    return () => { window.removeEventListener('message', onMsg); off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, target])
  // Who's in it changed: tell the page.
  useEffect(() => { if (ready.current) post({ evt: 'participants', data: people }) }, [people]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full flex flex-col rounded-2xl overflow-hidden border border-line bg-bg-2" data-activity-frame={session.key}>
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-line">
        <Gamepad2 size={16} className="text-accent" /><span className="font-semibold text-sm truncate">{builtinText(t, session.key, session.name)[0]}</span>
        <span className="flex -space-x-1.5 ml-1" data-activity-people={session.participants.length}>{people.slice(0, 6).map((p) => <span key={p.id} className="rounded-full ring-2 ring-bg-2"><Avatar user={p} size={20} /></span>)}</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => ref.current?.requestFullscreen?.().catch(() => {})} title={t('Fullscreen')} className="h-7 w-7 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><Maximize2 size={15} /></button>
          <button type="button" onClick={() => leaveActivity(session.id)} className="h-7 rounded-md px-2 flex items-center gap-1.5 text-sm text-danger hover:bg-danger/15" data-activity-leave><LogOut size={14} />{t('Leave Activity')}</button>
        </span>
      </div>
      <div className="relative flex-1 min-h-0">
        <iframe ref={ref} src={session.url} title={session.name} className="absolute inset-0 h-full w-full border-0 bg-black"
          sandbox={builtin ? (session.key === 'watch' ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : 'allow-scripts') : 'allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock'}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture" data-activity-iframe />
        {ask && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4" data-activity-authorize>
            <div className="w-full max-w-sm rounded-xl bg-bg-1 border border-line p-4 space-y-3">
              <h3 className="font-bold">{t('{app} wants to know who you are', { app: session.name })}</h3>
              <p className="text-sm text-text-2">{ask.scope.includes('guilds') ? t('It will see your username, avatar and the servers you are in.') : t('It will see your username and avatar.')}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => ask.done(false)} className="btn-ghost">{t('Cancel')}</button>
                <button type="button" onClick={() => ask.done(true)} className="btn-primary" data-activity-authorize-ok>{t('Authorize')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
