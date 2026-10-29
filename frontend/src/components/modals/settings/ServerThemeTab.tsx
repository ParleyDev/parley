import { useState } from 'react'
import { Check } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'
import { useColorThemes, type Look } from '../../../lib/colorThemes'
import ThemeEditor, { MiniApp, ThemeSwatch } from '../../ThemeEditor'

const STARTER: Look = { base: 'dark', angle: 150, midpoint: 40, stops: [{ color: '#5865f2', pos: 10 }, { color: '#eb459e', pos: 90 }] }

/**
 * Server Settings → Theme: a colour theme the server's members see while they're in it (unless they chose to keep
 * their own in Appearance): none, one of the instance's themes, or the server's own gradient.
 */
export default function ServerThemeTab({ guildId }: { guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const themes = useColorThemes()
  const cur = guild?.theme ?? null
  const [custom, setCustom] = useState<Look>(cur?.custom ?? STARTER)
  const [editing, setEditing] = useState(!!cur?.custom)
  const save = async (theme: { id?: string; custom?: Look } | null) => {
    try { await api.patch(`/guilds/${guildId}`, { theme }); pushToast(theme ? t('Server theme saved') : t('Server theme removed')) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="space-y-6" data-server-theme-tab>
      <div><h2 className="text-xl font-bold">{t('Server Theme')}</h2><p className="text-sm text-text-2 mt-1">{t("Members see this theme while they're in the server, unless they've chosen to keep their own in Appearance.")}</p></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-3" data-server-theme-options>
        <button type="button" onClick={() => { setEditing(false); void save(null) }} aria-pressed={!cur} className="flex flex-col items-center gap-1 text-[11px]" data-server-theme-none>
          <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 bg-bg-2 ${!cur ? 'border-accent ring-2 ring-accent/40' : 'border-line'}`}>{!cur && <Check size={18} className="text-accent" />}</span>
          <span className={!cur ? 'font-semibold text-text-0' : 'text-text-2'}>{t('None')}</span>
        </button>
        {themes.map((th) => {
          const on = cur?.id === th.id
          return (
            <button key={th.id} type="button" onClick={() => { setEditing(false); void save({ id: th.id }) }} aria-pressed={on} title={th.name} className="flex flex-col items-center gap-1 text-[11px]" data-server-theme-pick={th.slug}>
              <ThemeSwatch look={th} size={52} selected={on} />
              <span className={`max-w-[72px] truncate ${on ? 'font-semibold text-text-0' : 'text-text-2'}`}>{th.name}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => setEditing(true)} aria-pressed={!!cur?.custom} className="flex flex-col items-center gap-1 text-[11px]" data-server-theme-custom>
          <ThemeSwatch look={custom} size={52} selected={!!cur?.custom} />
          <span className={cur?.custom ? 'font-semibold text-text-0' : 'text-text-2'}>{t('Custom')}</span>
        </button>
      </div>
      {editing && (
        <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3">
          <ThemeEditor value={custom} onChange={setCustom} />
          <button type="button" className="btn-primary" onClick={() => void save({ custom })} data-server-theme-save>{t('Use this theme for the server')}</button>
        </div>
      )}
      {cur && !editing && cur.id && (() => { const th = themes.find((x) => x.id === cur.id); return th ? <MiniApp look={th} className="max-w-md" /> : null })()}
    </div>
  )
}
