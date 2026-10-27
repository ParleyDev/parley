import { BookOpenCheck, ChevronRight, Hash, MessageSquareText, Volume2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { colorFor, initials } from '../../lib/format'
import { useStore } from '../../store'
import Emoji from '../Emoji'
import type { WelcomeScreen } from '../../lib/types'
import { useT, tn } from '../../lib/i18n'

/** The server's welcome screen: what it is about and a few channels to start in. Shown once after joining. */
export default function WelcomeModal({ onClose, guildId, draft }: { onClose: () => void; guildId: string; draft?: WelcomeScreen }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const navigate = useNavigate()
  if (!guild) return null
  const w = draft ?? guild.welcome_screen ?? {}
  const picks = (w.channels ?? []).filter((c) => channels[c.channel_id])
  const rules = guild.rules_channel_id ? channels[guild.rules_channel_id] : undefined
  const go = (id: string) => { onClose(); if (!draft) navigate(`/channels/${guildId}/${id}`) }
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal aria-label={t('Welcome to {name}', { name: guild.name })} data-welcome-screen={guildId}>
      <div className="pop w-full max-w-md rounded-2xl border border-line bg-bg-1 p-6 shadow-2xl text-center">
        <div className="mx-auto h-20 w-20 overflow-hidden rounded-3xl flex items-center justify-center text-2xl font-bold text-white" style={{ background: guild.icon_url ? undefined : colorFor(guild.id) }}>
          {guild.icon_url ? <img src={guild.icon_url} alt="" className="h-full w-full object-cover" /> : initials(guild.name)}
        </div>
        <h2 className="mt-4 text-2xl font-bold">{tn('Welcome to {name}!', { name: <span className="break-words">{guild.name}</span> })}</h2>
        {(w.description || guild.description) && <p className="mt-2 text-sm text-text-1 break-words" data-welcome-description>{w.description || guild.description}</p>}
        {picks.length > 0 && (
          <div className="mt-5 text-left">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Here are some things you can do')}</div>
            <div className="space-y-2">
              {picks.map((c) => {
                const ch = channels[c.channel_id]
                return (
                  <button key={c.channel_id} type="button" onClick={() => go(c.channel_id)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-left hover:bg-bg-3" data-welcome-channel={c.channel_id}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">{c.emoji ? <Emoji value={c.emoji} size={24} /> : ch.kind === 'voice' ? <Volume2 size={20} className="text-text-2" /> : ch.kind === 'forum' ? <MessageSquareText size={20} className="text-text-2" /> : <Hash size={20} className="text-text-2" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.description || ch.name}</span>
                      <span className="block truncate text-xs text-text-2">{ch.kind === 'voice' ? '🔊' : '#'}{ch.name}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-text-2" />
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {rules && <button type="button" onClick={() => go(rules.id)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-sky-400 hover:underline" data-welcome-rules><BookOpenCheck size={15} /> {t('Read the rules in #{name}', { name: rules.name })}</button>}
        <button type="button" onClick={onClose} className="btn-primary mt-5 w-full justify-center" data-welcome-close>{t('Explore the server')}</button>
      </div>
    </div>
  )
}
