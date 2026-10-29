import { useState } from 'react'
import { usePrefs } from '../lib/prefs'
import { useT } from '../lib/i18n'

/**
 * An email address as Discord shows your own: masked (********@example.com) with a Reveal link, so it isn't read off a
 * shared or streamed screen by accident. Streamer Mode (when it hides personal info) hides it entirely, with no Reveal.
 */
export default function MaskedEmail({ email, reveal = true }: { email: string; reveal?: boolean }) {
  const t = useT()
  const prefs = usePrefs()
  const [shown, setShown] = useState(false)
  if (prefs.streamer && prefs.streamerHideInfo) return <span className="italic text-text-2" title={t('Hidden by Streamer Mode')} data-streamer-masked data-email-hidden>{t('Hidden by Streamer Mode')}</span>
  const at = email.lastIndexOf('@')
  const masked = at > 0 ? `${'*'.repeat(Math.max(4, Math.min(12, at)))}${email.slice(at)}` : '********'
  return (
    <span data-masked-email={shown ? 'revealed' : 'masked'}>
      <span data-email-value>{shown ? email : masked}</span>
      {reveal && <button type="button" onClick={() => setShown((s) => !s)} className="ml-1.5 text-sky-400 hover:underline font-normal" data-email-reveal>{shown ? t('Hide') : t('Reveal')}</button>}
    </span>
  )
}
