import { Check, Minus, Plus, Shield, Trash2, User as UserIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { myChannelPerms, useStore } from '../../../store'
import { canManageRole, has, P, PERMS, sortedRoles, EMPTY_ROLES } from '../../../lib/perms'
import Avatar from '../../Avatar'
import { Toggle } from '../SettingsShell'
import { useT, tn } from '../../../lib/i18n'

type Tri = 'allow' | 'neutral' | 'deny'

export default function ChannelPermissionsTab({ channelId }: { channelId: string }) {
  const t = useT()
  const channel = useStore((s) => s.channels[channelId])
  const guildId = channel?.guild_id ?? ''
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const loadMembers = useStore((s) => s.loadMembers)
  const me = useStore((s) => s.user)
  const myMember = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const myPerms = useStore((s) => myChannelPerms(s, channelId))
  const pushToast = useStore((s) => s.pushToast)
  const [selected, setSelected] = useState<string>(guildId)
  const [adding, setAdding] = useState(false)
  useEffect(() => { if (guildId && !loaded) loadMembers(guildId) }, [guildId, loaded, loadMembers])
  if (!channel || !guild || !me) return null

  const ows = channel.overwrites ?? []
  const ctx = { guild, roles, member: myMember }
  const isAdmin = has(myPerms, P.ADMINISTRATOR)
  const everyone = ows.find((o) => o.id === guildId)
  const isPrivate = !!everyone && has(everyone.deny, P.VIEW_CHANNEL)

  const put = async (targetId: string, kind: 'role' | 'member', allow: number, deny: number) => {
    try { await api.put(`/channels/${channelId}/permissions/${targetId}`, { kind, allow, deny }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const clear = async (targetId: string) => {
    try { await api.delete(`/channels/${channelId}/permissions/${targetId}`); if (selected === targetId) setSelected(guildId) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const setPrivate = async (v: boolean) => {
    const cur = everyone ?? { allow: 0, deny: 0 }
    if (v) {
      await put(guildId, 'role', cur.allow & ~P.VIEW_CHANNEL, cur.deny | P.VIEW_CHANNEL)
      // Keep yourself in, unless you'd still see it anyway.
      if (guild.owner_id !== me.id && !isAdmin) {
        const mine = ows.find((o) => o.id === me.id)
        await put(me.id, 'member', (mine?.allow ?? 0) | P.VIEW_CHANNEL, (mine?.deny ?? 0) & ~P.VIEW_CHANNEL)
      }
    } else {
      await put(guildId, 'role', cur.allow, cur.deny & ~P.VIEW_CHANNEL)
    }
  }

  // Targets: @everyone first, then roles with overwrites, then members with overwrites.
  const roleTargets = sortedRoles(roles).filter((r) => r.id === guildId || ows.some((o) => o.id === r.id))
  const memberTargets = ows.filter((o) => o.kind === 'member').map((o) => members?.[o.id]).filter((m): m is NonNullable<typeof m> => !!m)
  const addableRoles = sortedRoles(roles).filter((r) => r.id !== guildId && !ows.some((o) => o.id === r.id) && canManageRole(ctx, me.id, r))
  const addableMembers = Object.values(members ?? {}).filter((m) => !ows.some((o) => o.id === m.user_id))

  const sel = ows.find((o) => o.id === selected) ?? { id: selected, kind: roles[selected] ? 'role' as const : 'member' as const, allow: 0, deny: 0 }
  const selRole = roles[selected]
  const selMember = members?.[selected]
  const selName = selRole ? selRole.name : selMember ? (selMember.nickname ?? selMember.display_name) : t('Unknown')
  const selEditable = selRole ? canManageRole(ctx, me.id, selRole) : true
  const relevant = PERMS.filter((p) => p.channel && (p.channel === 'both' || p.channel === channel.kind))

  const setTri = (bit: number, v: Tri) => {
    const allow = v === 'allow' ? sel.allow | bit : sel.allow & ~bit
    const deny = v === 'deny' ? sel.deny | bit : sel.deny & ~bit
    put(selected, sel.kind, allow, deny)
  }

  const parent = channel.parent_id ? useStore.getState().channels[channel.parent_id] : undefined
  const sync = async () => { try { await api.post(`/channels/${channelId}/permissions-sync`) ; pushToast(t('Synced with {name}', { name: parent?.name ?? t('the category') })) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div>
      <h1 className="text-xl font-bold">{channel.kind === 'category' ? t('Category Permissions') : t('Channel Permissions')}</h1>
      <p className="text-sm text-text-2 mt-1">{channel.kind === 'category' ? t('Channels in this category that are synced follow these permissions.') : t('Use permissions to customise who can do what in this channel.')}</p>
      {parent && (
        <div className={`mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${channel.permissions_synced ? 'border-success/40 bg-success/10' : 'border-warn/40 bg-warn/10'}`} data-perm-sync={channel.permissions_synced ? 'synced' : 'unsynced'}>
          <span className="flex-1">{channel.permissions_synced ? <>{tn('Permissions synced with category: {name}', { name: <b>{parent.name}</b> })}</> : <>{tn("This channel has its own permissions, not {name}'s.", { name: <b>{parent.name}</b> })}</>}</span>
          {!channel.permissions_synced && has(myPerms, P.MANAGE_ROLES) && <button type="button" className="btn-primary py-1" onClick={sync} data-perm-sync-now>{t('Sync Now')}</button>}
        </div>
      )}

      <div className="mt-5 rounded-xl bg-bg-0/50 border border-line p-4">
        <Toggle label={t('Private channel')} checked={isPrivate} onChange={setPrivate} disabled={!isAdmin && !has(myPerms, P.VIEW_CHANNEL)} />
        <p className="text-sm text-text-2 mt-1">{t('Only selected members and roles will be able to view this channel.')}</p>
      </div>

      <div className="mt-6 flex gap-6 max-md:flex-col">
        <div className="w-60 max-md:w-full shrink-0">
          <div className="flex items-center justify-between mb-2 relative">
            <span className="label mb-0">{t('Roles / Members')}</span>
            <button onClick={() => setAdding((a) => !a)} className="text-text-2 hover:text-text-0" title={t('Add role or member')}><Plus size={16} /></button>
            {adding && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAdding(false)} />
                <div className="pop absolute right-0 top-full mt-1 z-40 w-64 max-h-72 overflow-y-auto rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5">
                  {addableRoles.length > 0 && <div className="px-2 py-1 text-[11px] font-bold uppercase text-text-2">{t('Roles')}</div>}
                  {addableRoles.map((r) => (
                    <button key={r.id} onClick={() => { setAdding(false); put(r.id, 'role', 0, 0).then(() => setSelected(r.id)) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-3 text-left">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? '#7d8394' }} /><span className="truncate">{r.name}</span>
                    </button>
                  ))}
                  {addableMembers.length > 0 && <div className="px-2 py-1 text-[11px] font-bold uppercase text-text-2">{t('Members')}</div>}
                  {addableMembers.map((m) => (
                    <button key={m.user_id} onClick={() => { setAdding(false); put(m.user_id, 'member', 0, 0).then(() => setSelected(m.user_id)) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-3 text-left">
                      <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={20} /><span className="truncate">{m.nickname ?? m.display_name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="space-y-0.5">
            {roleTargets.map((r) => (
              <button key={r.id} onClick={() => setSelected(r.id)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left ${selected === r.id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`}>
                <Shield size={14} style={{ color: r.color ?? undefined }} /><span className="truncate">{r.name}</span>
              </button>
            ))}
            {memberTargets.map((m) => (
              <button key={m.user_id} onClick={() => setSelected(m.user_id)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left ${selected === m.user_id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`}>
                <UserIcon size={14} /><span className="truncate">{m.nickname ?? m.display_name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold truncate">{selName}</h2>
            {!selEditable && <span className="text-xs text-text-2 rounded bg-bg-3 px-2 py-0.5">{t('Read only')}</span>}
            {selected !== guildId && ows.some((o) => o.id === selected) && selEditable && (
              <button onClick={() => clear(selected)} className="ml-auto text-danger hover:bg-danger/10 rounded-md p-1.5" title={t('Remove overwrite')}><Trash2 size={16} /></button>
            )}
          </div>
          <div className="divide-y divide-line">
            {relevant.map((p) => {
              const bit = P[p.key]
              const v: Tri = has(sel.allow, bit) ? 'allow' : has(sel.deny, bit) ? 'deny' : 'neutral'
              const can = selEditable && (isAdmin || has(myPerms, bit))
              return (
                <div key={p.key} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0"><div className="text-[15px] font-medium">{t(p.label)}</div><div className="text-sm text-text-2">{t(p.desc)}</div></div>
                  <div className={`flex rounded-md border border-line overflow-hidden shrink-0 ${can ? '' : 'opacity-50 pointer-events-none'}`}>
                    <TriBtn on={v === 'deny'} cls="bg-danger text-white" onClick={() => setTri(bit, 'deny')} title={t('Deny')}><X size={14} /></TriBtn>
                    <TriBtn on={v === 'neutral'} cls="bg-bg-4 text-text-0" onClick={() => setTri(bit, 'neutral')} title={t('Inherit')}><Minus size={14} /></TriBtn>
                    <TriBtn on={v === 'allow'} cls="bg-success text-black" onClick={() => setTri(bit, 'allow')} title={t('Allow')}><Check size={14} /></TriBtn>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function TriBtn({ on, cls, onClick, title, children }: { on: boolean; cls: string; onClick: () => void; title: string; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className={`h-8 w-9 flex items-center justify-center ${on ? cls : 'bg-bg-2 text-text-2 hover:bg-bg-3'}`}>{children}</button>
}
