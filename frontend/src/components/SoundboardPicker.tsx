import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_SOUNDS } from '../lib/builtinSounds'
import { useStore } from '../store'

/** The soundboard grid: built-ins, this server's sounds, then sounds from your other servers. */
export default function SoundboardPicker({ guildId, onPlay }: { guildId?: string | null; onPlay: (id: string) => void }) {
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const sounds = useStore((s) => s.sounds)
  useEffect(() => { for (const g of guilds) if (!sounds[g.id]) void useStore.getState().loadSounds(g.id) }, [guilds]) // eslint-disable-line react-hooks/exhaustive-deps
  const order = useMemo(() => (guildId ? [...guilds.filter((g) => g.id === guildId), ...guilds.filter((g) => g.id !== guildId)] : guilds), [guilds, guildId])
  const cell = (id: string, emoji: string, name: string) => (
    <button key={id} type="button" onClick={() => onPlay(id)} className="rounded-lg bg-bg-3 hover:bg-accent hover:text-white px-2 py-2 text-xs font-semibold flex flex-col items-center gap-1" data-sound={id} title={name}>
      <span className="text-xl leading-none">{emoji || '🔊'}</span><span className="truncate max-w-full">{name}</span>
    </button>
  )
  return (
    <div className="max-h-72 overflow-y-auto space-y-3" data-soundboard-picker>
      <section>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Default</div>
        <div className="grid grid-cols-3 gap-2">{BUILTIN_SOUNDS.map((b) => cell(`builtin:${b.id}`, b.emoji, b.name))}</div>
      </section>
      {order.filter((g) => (sounds[g.id]?.length ?? 0) > 0).map((g) => (
        <section key={g.id} data-soundboard-guild={g.id}>
          <div className="mb-1 truncate text-[11px] font-bold uppercase tracking-wider text-text-2">{g.name}</div>
          <div className="grid grid-cols-3 gap-2">{sounds[g.id]!.map((s) => cell(s.id, s.emoji, s.name))}</div>
        </section>
      ))}
    </div>
  )
}
