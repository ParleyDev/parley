import { Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import Modal from '../Modal'
import { CHANGELOG, markSeen } from '../../lib/changelog'
import { locale, useT } from '../../lib/i18n'

/** Release notes, newest first. Opening it counts as seeing the latest. */
export default function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  useEffect(() => { markSeen() }, [])
  return (
    <Modal title={t("What's New")} onClose={onClose} width="max-w-lg" footer={<button className="btn-primary" onClick={onClose} data-whats-new-close>{t('Got it')}</button>}>
      <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1" data-whats-new>
        {CHANGELOG.map((e, i) => (
          <section key={e.id} data-changelog-entry={e.id}>
            <div className="flex items-center gap-2">
              {i === 0 && <Sparkles size={16} className="text-accent" />}
              <h3 className="font-bold">{t(e.title)}</h3>
              <span className="ml-auto text-xs text-text-2">{new Date(e.date + 'T12:00:00').toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
            <ul className="mt-2 list-disc ps-5 space-y-1 text-sm text-text-1">{e.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
