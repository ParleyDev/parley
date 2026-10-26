import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { BUILTIN_SOUNDS, builtinUrl } from '../lib/builtinSounds'
import { setPrefs, usePrefs } from '../lib/prefs'
import type { PrivateUser } from '../lib/types'
import { useStore } from '../store'

/** Voice & Video: the sound everyone in the channel hears when you join, and whether you hear other people's. */
export default function EntranceSound() {
  const me = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  const guilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter(Boolean)))
  const sounds = useStore((s) => s.sounds)
  const prefs = usePrefs()
  const [busy, setBusy] = useState(false)
  useEffect(() => { for (const g of guilds) if (!sounds[g.id]) void useStore.getState().loadSounds(g.id) }, [guilds]) // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => [
    ...BUILTIN_SOUNDS.map((b) => ({ id: `builtin:${b.id}`, label: `${b.emoji} ${b.name}`, group: 'Default', url: '' })),
    ...guilds.flatMap((g) => (sounds[g.id] ?? []).map((s) => ({ id: s.id, label: `${s.emoji || '🔊'} ${s.name}`, group: g.name, url: s.url }))),
  ], [guilds, sounds])
  if (!me) return null
  const save = async (id: string) => {
    setBusy(true)
    try { const u = await api.patch<PrivateUser>('/users/@me', { entrance_sound: id }); if (token) setAuth(token, u) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const preview = () => { const o = options.find((x) => x.id === me.entrance_sound); const url = o ? (o.url || builtinUrl(o.id)) : ''; if (url) void new Audio(url).play().catch(() => {}) }
  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <section className="space-y-2" data-entrance-sound>
      <h3 className="text-base font-bold">Entrance Sound</h3>
      <p className="text-sm text-text-2">Played to everyone in a server voice channel when you join it. Pick a default sound or one from any of your servers.</p>
      <div className="flex items-center gap-2">
        <select className="input w-auto max-w-full" value={me.entrance_sound ?? ''} disabled={busy} onChange={(e) => save(e.target.value)} aria-label="Entrance sound" data-entrance-select>
          <option value="">None</option>
          {groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
        </select>
        {me.entrance_sound && <button type="button" className="btn-ghost" onClick={preview}>Preview</button>}
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-accent" checked={prefs.entranceSounds} onChange={(e) => setPrefs({ entranceSounds: e.target.checked })} data-entrance-hear /> Play other people's entrance sounds</label>
    </section>
  )
}
