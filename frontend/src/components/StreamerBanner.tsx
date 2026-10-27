import { Radio } from 'lucide-react'
import { setPrefs, usePrefs } from '../lib/prefs'
import { useT, tn } from '../lib/i18n'

/** Top-of-app strip while Streamer Mode is on, with a one-click off switch. */
export default function StreamerBanner() {
  const p = usePrefs()
  const t = useT()
  if (!p.streamer) return null
  return (
    <div className="shrink-0 bg-accent/20 border-b border-accent/40 text-xs px-3 py-1.5 flex items-center justify-center gap-3 text-text-0" data-streamer-banner>
      <Radio size={14} className="text-accent" />
      <span>{tn('{feature} is on', { feature: <b>{t('Streamer Mode')}</b> })}{p.streamerHideInfo ? t(' · personal info hidden') : ''}{p.streamerHideInvites ? t(' · invites blurred') : ''}{p.streamerMuteSounds ? t(' · sounds off') : ''}{p.streamerMuteNotifications ? t(' · notifications off') : ''}.</span>
      <button type="button" onClick={() => setPrefs({ streamer: false })} className="font-semibold underline" data-streamer-off>{t('Turn off')}</button>
    </div>
  )
}
