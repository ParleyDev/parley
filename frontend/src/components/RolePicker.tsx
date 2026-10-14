import { Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { myGuildPerms, useStore } from '../store'
import type { Member } from '../lib/types'
import { canManageRole, has, highestPosition, P, sortedRoles, EMPTY_ROLES } from '../lib/perms'

/** Role chips for a member plus (if allowed) a popover to add/remove roles below your own highest. */
export default function RolePicker({ guildId, member, compact }: { guildId: string; member: Member; compact?: boolean }) {
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const me = useStore((s) => s.user)
  const myMember = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const myPerms = useStore((s) => myGuildPerms(s, guildId))
  const pushToast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState(false)
  if (!guild || !me) return null
  const ctx = { guild, roles, member: myMember }
  // You may re-role someone only if you outrank them (or you are the owner), and only with roles below your own.
  const outranks = guild.owner_id === me.id || (guild.owner_id !== member.user_id && highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, member.user_id))
  const canEdit = has(myPerms, P.MANAGE_ROLES) && (outranks || member.user_id === me.id)
  const assignable = sortedRoles(roles).filter((r) => r.id !== guildId && canManageRole(ctx, me.id, r))
  const mine = sortedRoles(roles).filter((r) => member.roles.includes(r.id))

  const setRoles = async (next: string[]) => {
    try { await api.patch(`/guilds/${guildId}/members/${member.user_id}`, { roles: next }) } catch (e) { pushToast((e as Error).message, 'error') }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 relative">
      {mine.map((r) => (
        <span key={r.id} className={`flex items-center gap-1 rounded-md border border-line bg-bg-3 pl-1.5 pr-1.5 ${compact ? 'text-[11px] py-0' : 'text-xs py-0.5'}`}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ? (r.color_accent ? `linear-gradient(90deg, ${r.color}, ${r.color_accent})` : r.color) : '#7d8394' }} />
          {r.name}
          {canEdit && assignable.some((a) => a.id === r.id) && <button onClick={() => setRoles(member.roles.filter((x) => x !== r.id))} className="text-text-2 hover:text-text-0" title="Remove role"><X size={11} /></button>}
        </span>
      ))}
      {mine.length === 0 && !canEdit && <span className="text-xs text-text-2">No roles</span>}
      {canEdit && assignable.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} className={`rounded-md border border-line bg-bg-3 text-text-1 hover:text-text-0 flex items-center justify-center ${compact ? 'h-4 w-5' : 'h-5 w-6'}`} title="Add role"><Plus size={12} /></button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="pop absolute left-0 top-full mt-1 z-40 w-56 max-h-64 overflow-y-auto rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5">
            {assignable.map((r) => {
              const on = member.roles.includes(r.id)
              return (
                <button key={r.id} onClick={() => setRoles(on ? member.roles.filter((x) => x !== r.id) : [...member.roles, r.id])} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-3 text-left">
                  <span className={`h-4 w-4 rounded border flex items-center justify-center ${on ? 'bg-accent border-accent' : 'border-text-2'}`}>{on && <Check size={12} />}</span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ? (r.color_accent ? `linear-gradient(90deg, ${r.color}, ${r.color_accent})` : r.color) : '#7d8394' }} />
                  <span className="truncate">{r.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
