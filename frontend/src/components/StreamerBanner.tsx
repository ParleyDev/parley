import { Radio } from 'lucide-react'
import { setPrefs, usePrefs } from '../lib/prefs'

/** Top-of-app strip while Streamer Mode is on, with a one-click off switch. */
export default function StreamerBanner() {
  const p = usePrefs()
  if (!p.streamer) return null
  return (
    <div className="shrink-0 bg-accent/20 border-b border-accent/40 text-xs px-3 py-1.5 flex items-center justify-center gap-3 text-text-0" data-streamer-banner>
      <Radio size={14} className="text-accent" />
      <span><b>Streamer Mode</b> is on{p.streamerHideInfo ? ' · personal info hidden' : ''}{p.streamerHideInvites ? ' · invites blurred' : ''}{p.streamerMuteSounds ? ' · sounds off' : ''}{p.streamerMuteNotifications ? ' · notifications off' : ''}.</span>
      <button type="button" onClick={() => setPrefs({ streamer: false })} className="font-semibold underline" data-streamer-off>Turn off</button>
    </div>
  )
}
