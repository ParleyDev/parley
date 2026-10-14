import { LogOut, Mic, User as UserIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import AccountTab from './settings/AccountTab'
import VoiceVideoTab from './settings/VoiceVideoTab'

type Tab = 'account' | 'voice'

export default function UserSettingsModal({ onClose, tab: initial = 'account' }: { onClose: () => void; tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial)
  const logout = useStore((s) => s.logout)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const NavItem = ({ id, icon, label }: { id: Tab; icon: React.ReactNode; label: string }) => (
    <button onClick={() => setTab(id)} className={`w-full max-md:w-auto whitespace-nowrap flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-left ${tab === id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>{icon}{label}</button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-bg-1 flex max-md:flex-col pop" role="dialog" aria-modal>
      <nav className="w-[232px] shrink-0 bg-bg-0/60 flex justify-end max-md:w-full max-md:justify-start max-md:pr-12 max-md:border-b max-md:border-line">
        <div className="w-[200px] py-14 pr-2 space-y-0.5 max-md:w-full max-md:py-2 max-md:pr-2 max-md:pl-2 max-md:flex max-md:items-center max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto">
          <h3 className="px-2.5 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2 max-md:hidden">User Settings</h3>
          <NavItem id="account" icon={<UserIcon size={16} />} label="My Account" />
          <h3 className="px-2.5 mt-5 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2 max-md:hidden">App Settings</h3>
          <NavItem id="voice" icon={<Mic size={16} />} label="Voice & Video" />
          <div className="h-px bg-line my-3 mx-2 max-md:hidden" />
          <button onClick={() => { onClose(); logout() }} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title="Log Out"><span className="max-md:hidden">Log Out</span><LogOut size={16} /></button>
        </div>
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[740px] px-10 py-14 max-md:px-4 max-md:py-5 relative">
          {tab === 'account' ? <AccountTab onClose={onClose} /> : <VoiceVideoTab />}
        </div>
      </div>
      <div className="w-[60px] shrink-0 pt-14 pr-6 hidden md:block">
        <button onClick={onClose} className="flex flex-col items-center gap-1 text-text-2 hover:text-text-0">
          <span className="h-9 w-9 rounded-full border-2 border-text-2 flex items-center justify-center hover:border-text-0"><X size={18} /></span>
          <span className="text-[11px] font-bold">ESC</span>
        </button>
      </div>
      <button onClick={onClose} className="md:hidden absolute right-3 top-3 h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={22} /></button>
    </div>
  )
}
