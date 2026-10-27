import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useT } from '../../lib/i18n'
import { profileCardStyle } from '../../lib/profileLook'
import { useStore } from '../../store'
import ProfileEditor from '../profile/ProfileEditor'

/** Edit Profile: the profile editor in a large overlay tinted with your profile theme (full screen on phones). */
export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const user = useStore((s) => s.user)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-editor-panel], [data-name-style-modal]')) onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  if (!user) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 max-lg:p-0" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pop relative w-full max-w-[1400px] h-[min(860px,94vh)] rounded-2xl border overflow-hidden shadow-2xl flex flex-col max-lg:h-full max-lg:rounded-none max-lg:border-0 safe-area" style={profileCardStyle(user, 0.86)} role="dialog" aria-modal aria-label={t('Edit Profile')} data-edit-profile>
        {/* Phones: a header bar that never scrolls away, below the status bar, with a thumb-sized close button. */}
        <div className="lg:hidden relative z-30 h-14 shrink-0 flex items-center gap-2 pl-4 pr-2 border-b border-white/10 bg-black/30" data-edit-profile-header>
          <span className="flex-1 truncate text-lg font-bold text-white">{t('Edit Profile')}</span>
          <button type="button" onClick={onClose} className="h-11 w-11 rounded-full text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-center" aria-label={t('Close')} data-edit-profile-close><X size={24} /></button>
        </div>
        <button type="button" onClick={onClose} className="max-lg:hidden absolute right-3 top-3 z-30 h-9 w-9 rounded-full bg-black/40 text-white/80 hover:text-white flex items-center justify-center" aria-label={t('Close')} data-edit-profile-close><X size={18} /></button>
        <div className="flex-1 min-h-0"><ProfileEditor /></div>
      </div>
    </div>
  )
}
