import { LogOut, Mic, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../store'
import AccountTab from './settings/AccountTab'
import VoiceVideoTab from './settings/VoiceVideoTab'
import SettingsShell from './SettingsShell'

type Tab = 'account' | 'voice'

export default function UserSettingsModal({ onClose, tab: initial = 'account' }: { onClose: () => void; tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial)
  const logout = useStore((s) => s.logout)
  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose}
      sections={[
        { title: 'User Settings', items: [{ id: 'account', label: 'My Account', icon: <UserIcon size={16} /> }] },
        { title: 'App Settings', items: [{ id: 'voice', label: 'Voice & Video', icon: <Mic size={16} /> }] },
      ]}
      footer={<button onClick={() => { onClose(); logout() }} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title="Log Out"><span className="max-md:hidden">Log Out</span><LogOut size={16} /></button>}
    >
      {tab === 'account' ? <AccountTab onClose={onClose} /> : <VoiceVideoTab />}
    </SettingsShell>
  )
}
