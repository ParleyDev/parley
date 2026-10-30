import { ChevronDown, ChevronRight, Settings, ShieldCheck, SmilePlus, UserCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useStore } from '../store'
import AccountSwitcher from './AccountSwitcher'
import { applyStatus, statusDurations, statuses, StatusDot } from './UserMenu'

/**
 * The floating bar at the bottom of your own profile on a phone (Discord mobile's Quests / Shop / Nitro / Settings):
 * status, accounts and settings, which the desktop self menu holds. Status and accounts open a panel over the bar.
 */
export default function SelfDock({ onClose }: { onClose: () => void }) {
  const t = useT()
  const user = useStore((s) => s.user)!
  const openModal = useStore((s) => s.openModal)
  const navigate = useNavigate()
  const [panel, setPanel] = useState<'status' | 'accounts' | null>(null)
  const [durations, setDurations] = useState<string | null>(null)
  const current = statuses().find((s) => s.v === user.status) ?? statuses()[0]
  const go = (fn: () => void) => { onClose(); fn() }
  const set = (v: string, secs?: number) => { setPanel(null); setDurations(null); void applyStatus(v, secs) }
  const btn = 'flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-text-1 active:bg-white/10'
  const row = 'w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left text-[15px] active:bg-white/[.06]'

  return (
    <>
      {panel && <div className="absolute inset-0 z-30 bg-black/40" onClick={() => setPanel(null)} data-self-dock-backdrop />}
      {panel && (
        <div className="absolute inset-x-0 bottom-0 z-40 max-h-[70%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 bg-[var(--color-float)] p-2 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-2xl sheet-up" role="menu" data-self-dock-panel={panel} data-no-sheet-drag>
          <div className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full bg-white/20" />
          {panel === 'status' && (
            <>
              <button type="button" onClick={() => go(() => openModal({ kind: 'customStatus' }))} className={row} data-self-custom-status>
                <SmilePlus size={18} className="shrink-0 text-text-2" /><span className="min-w-0 flex-1 truncate">{user.custom_status || t('Set a custom status')}</span>
              </button>
              <div className="my-1 h-px bg-white/10" />
              {statuses().map((s) => (
                <div key={s.v}>
                  <div className="flex items-center">
                    <button type="button" onClick={() => set(s.v)} className={`${row} items-start`} aria-pressed={user.status === s.v} data-status-option={s.v}>
                      <span className="mt-1.5 flex"><StatusDot v={s.v} size={12} /></span>
                      <span className="min-w-0"><span className={`block font-semibold ${user.status === s.v ? 'text-text-0' : 'text-text-1'}`}>{s.label}</span>{s.note && <span className="block text-xs text-text-2">{s.note}</span>}</span>
                    </button>
                    {s.v !== 'online' && (
                      <button type="button" onClick={() => setDurations((d) => (d === s.v ? null : s.v))} className="shrink-0 rounded-lg p-3 text-text-2" aria-label={t('{status} for a while', { status: s.label })} aria-expanded={durations === s.v} data-status-durations={s.v}>
                        {durations === s.v ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                    )}
                  </div>
                  {durations === s.v && (
                    <div className="mb-1 ml-9 space-y-0.5" data-status-duration-list={s.v}>
                      {statusDurations().map((d) => <button key={d.secs} type="button" onClick={() => set(s.v, d.secs)} className="w-full rounded-md px-3 py-2 text-left text-sm active:bg-white/[.06]" data-status-for={d.secs}>{d.label}</button>)}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {panel === 'accounts' && (
            <>
              <AccountSwitcher />
              <div className="my-1 h-px bg-white/10" />
              <button type="button" onClick={() => go(() => openModal({ kind: 'userSettings', tab: 'account' }))} className={`${row} font-semibold`} data-manage-accounts>{t('Manage Accounts')}</button>
            </>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-20 flex justify-center" data-self-dock>
        <div className="pointer-events-auto flex gap-1 rounded-2xl border border-white/10 bg-[var(--color-float)] p-1.5 shadow-2xl">
          <button type="button" onClick={() => setPanel('status')} className={btn} data-self-dock-status><span className="flex h-5 items-center"><StatusDot v={current.v} size={14} /></span>{t('Status')}</button>
          <button type="button" onClick={() => setPanel('accounts')} className={btn} data-self-dock-accounts><UserCircle size={20} />{t('Accounts')}</button>
          {user.is_admin && <button type="button" onClick={() => go(() => navigate('/admin'))} className={btn} data-self-dock-admin><ShieldCheck size={20} />{t('Admin')}</button>}
          <button type="button" onClick={() => go(() => openModal({ kind: 'userSettings' }))} className={btn} data-self-dock-settings><Settings size={20} />{t('Settings')}</button>
        </div>
      </div>
    </>
  )
}
