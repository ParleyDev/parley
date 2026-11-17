import { CircleHelp } from 'lucide-react'
import { openGuide } from '../lib/guide'
import { useT } from '../lib/i18n'

/**
 * A small "Help" button that opens the guide at `topic` ('page' or 'page#heading'). Pass the topic as a string
 * literal so scripts/guide-build.mjs --check can tell when it stops existing.
 */
export default function HelpLink({ topic, label, className = '' }: { topic: string; label?: string; className?: string }) {
  const t = useT()
  return (
    <button type="button" onClick={() => openGuide(topic)} title={t('Open the guide')} aria-label={t('Help')} data-help-link={topic}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-text-2 hover:bg-bg-3 hover:text-text-0 ${className}`}>
      <CircleHelp size={15} />{label ?? t('Help')}
    </button>
  )
}
