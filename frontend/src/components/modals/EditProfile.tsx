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
      <div className="pop relative w-full max-w-[1400px] h-[min(860px,94vh)] rounded-2xl border overflow-hidden shadow-2xl max-lg:h-full max-lg:rounded-none safe-area" style={profileCardStyle(user, 0.86)} role="dialog" aria-modal aria-label={t('Edit Profile')} data-edit-profile>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-30 h-9 w-9 rounded-full bg-black/40 text-white/80 hover:text-white flex items-center justify-center" aria-label={t('Close')} data-edit-profile-close><X size={18} /></button>
        <ProfileEditor />
      </div>
    </div>
  )
}
