import { MailWarning, Pause, Play, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import type { Guild } from '../../../lib/types'
import { useStore } from '../../../store'
import { Toggle } from '../SettingsShell'

const LEVELS: { level: number; label: string; detail: string }[] = [
  { level: 0, label: 'None', detail: 'Anyone can talk as soon as they join.' },
  { level: 1, label: 'Low', detail: 'Must have a verified email address.' },
  { level: 2, label: 'Medium', detail: 'Verified email, and a Parley account older than 5 minutes.' },
  { level: 3, label: 'High', detail: 'All of the above, and a member of this server for 10 minutes.' },
]
const PAUSE_HOURS = [1, 2, 4, 6, 12, 24]

/** Server Settings › Safety: who may talk (verification level), 2FA for moderators, and pausing invites or DMs during a raid. */
export default function SafetyTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const me = useStore((s) => s.user)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [pauseFor, setPauseFor] = useState(24)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [])
  if (!guild) return null
  const save = async (patch: Record<string, unknown>, done: string) => {
    try { upsertGuild(await api.patch<Guild>(`/guilds/${guildId}`, patch)); pushToast(done) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const owner = guild.owner_id === me?.id
  const dmsPaused = !!guild.dms_paused_until && new Date(guild.dms_paused_until).getTime() > Date.now()
  const until = dmsPaused ? new Date(guild.dms_paused_until!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <div className="space-y-8" data-safety-tab>
      <div>
        <h1 className="text-xl font-bold">Safety</h1>
        <p className="text-sm text-text-2 mt-1">Keep spam and raids out of {guild.name}. Members with any role, and the owner, skip the verification level.</p>
      </div>

      <section data-security-actions>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Security actions</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-bg-1 p-3">
            <span className="flex-1 min-w-0"><span className="block text-[15px] font-medium">Pause invites</span><span className="block text-xs text-text-2">{guild.invites_paused ? 'Nobody new can join, through invites or Discover, until you resume.' : 'Stop new people joining while you deal with a raid. Existing members are not affected.'}</span></span>
            <button type="button" className={guild.invites_paused ? 'btn-primary' : 'btn-ghost'} onClick={() => save({ invites_paused: !guild.invites_paused }, guild.invites_paused ? 'Invites resumed' : 'Invites paused')} data-pause-invites={guild.invites_paused ? 'on' : 'off'}>
              {guild.invites_paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-1 p-3">
            <span className="flex-1 min-w-[12rem]"><span className="block text-[15px] font-medium">Pause DMs between members</span><span className="block text-xs text-text-2">{dmsPaused ? `Members who aren't friends can't message each other because of this server until ${until}.` : "Members who aren't friends can't start DMs with each other because they share this server."}</span></span>
            {dmsPaused
              ? <button type="button" className="btn-primary" onClick={() => save({ pause_dms_hours: 0 }, 'DMs resumed')} data-pause-dms="on"><Play size={14} /> Resume</button>
              : <span className="flex items-center gap-2">
                  <select className="input w-auto py-1.5" value={pauseFor} onChange={(e) => setPauseFor(Number(e.target.value))} aria-label="Pause DMs for" data-pause-dms-hours>
                    {PAUSE_HOURS.map((h) => <option key={h} value={h}>{h === 1 ? '1 hour' : `${h} hours`}</option>)}
                  </select>
                  <button type="button" className="btn-ghost" onClick={() => save({ pause_dms_hours: pauseFor }, `DMs paused for ${pauseFor === 1 ? '1 hour' : `${pauseFor} hours`}`)} data-pause-dms="off"><Pause size={14} /> Pause</button>
                </span>}
          </div>
        </div>
      </section>

      <section data-verification-level>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Verification level</h2>
        <p className="text-sm text-text-2 mb-3">What members without a role need before they can send messages.</p>
        <div className="space-y-2">
          {LEVELS.map((l) => (
            <label key={l.level} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${(guild.verification_level ?? 0) === l.level ? 'border-accent bg-accent/10' : 'border-line bg-bg-1'}`}>
              <input type="radio" name="verification" className="mt-1 h-4 w-4 accent-accent" checked={(guild.verification_level ?? 0) === l.level} onChange={() => save({ verification_level: l.level }, `Verification level set to ${l.label}`)} data-verification={l.level} />
              <span><span className="block text-[15px] font-medium">{l.label}</span><span className="block text-xs text-text-2">{l.detail}</span></span>
            </label>
          ))}
        </div>
      </section>

      <section data-mfa-requirement>
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2">Two-factor authentication for moderators</h2>
        <div className="rounded-xl border border-line bg-bg-1 p-3">
          <div className={!owner || (!me?.mfa_enabled && guild.mfa_level !== 1) ? 'opacity-60 pointer-events-none' : ''} data-mfa-toggle>
            <Toggle label="Require 2FA for moderator actions" checked={guild.mfa_level === 1} onChange={(v) => save({ mfa_level: v ? 1 : 0 }, v ? 'Moderators now need 2FA' : '2FA is no longer required')} />
          </div>
          <p className="mt-2 text-xs text-text-2">Members without two-factor authentication lose powers like kicking, banning, deleting messages and managing channels or roles until they turn it on. A stolen password alone can't be used to wreck the server.</p>
          {!owner && <p className="mt-2 flex items-center gap-1.5 text-xs text-text-2"><ShieldCheck size={14} /> Only the server owner can change this.</p>}
          {owner && !me?.mfa_enabled && guild.mfa_level !== 1 && <p className="mt-2 flex items-center gap-1.5 text-xs text-warn" data-mfa-needed><MailWarning size={14} /> Turn on two-factor authentication for your own account (User Settings › My Account) to require it here.</p>}
        </div>
      </section>
    </div>
  )
}
