import { Bell, Keyboard, Lock, LogOut, Mic, MonitorSmartphone, ShieldCheck, Server, Palette, Paintbrush, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../store'
import AccountTab from './settings/AccountTab'
import VoiceVideoTab from './settings/VoiceVideoTab'
import ProfilesTab from './settings/ProfilesTab'
import AppearanceTab from './settings/AppearanceTab'
import KeybindsTab from './settings/KeybindsTab'
import NotificationsTab from './settings/NotificationsTab'
import ContentSocialTab from './settings/ContentSocialTab'
import DevicesTab from './settings/DevicesTab'
import DataPrivacyTab from './settings/DataPrivacyTab'
import SettingsShell from './SettingsShell'
import { useT } from '../../lib/i18n'
import { isNative, switchServer, unregisterPush } from '../../lib/native'

type Tab = 'account' | 'profile' | 'social' | 'privacy' | 'devices' | 'voice' | 'appearance' | 'keybinds' | 'notifications'

export default function UserSettingsModal({ onClose, tab: initial = 'account' }: { onClose: () => void; tab?: Tab }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>(initial)
  const logout = useStore((s) => s.logout)
  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose}
      sections={[
        { title: t('User Settings'), items: [{ id: 'account', label: t('My Account'), icon: <UserIcon size={16} /> }, { id: 'profile', label: t('Profiles'), icon: <Palette size={16} /> }, { id: 'social', label: t('Content & Social'), icon: <ShieldCheck size={16} /> }, { id: 'privacy', label: t('Data & Privacy'), icon: <Lock size={16} /> }, { id: 'devices', label: t('Devices'), icon: <MonitorSmartphone size={16} /> }] },
        { title: t('App Settings'), items: [{ id: 'appearance', label: t('Appearance'), icon: <Paintbrush size={16} /> }, { id: 'voice', label: t('Voice & Video'), icon: <Mic size={16} /> }, { id: 'notifications', label: t('Notifications'), icon: <Bell size={16} /> }, { id: 'keybinds', label: t('Keybinds'), icon: <Keyboard size={16} /> }] },
      ]}
      footer={<><button onClick={() => { void unregisterPush().finally(() => { onClose(); logout() }) }} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title={t('Log Out')}><span className="max-md:hidden">Log Out</span><LogOut size={16} /></button>{isNative() && <button onClick={switchServer} className="w-full max-md:w-auto flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 whitespace-nowrap" title="Switch server" data-switch-server><span className="max-md:hidden">Switch server</span><Server size={16} /></button>}</>}
    >
      {tab === 'account' ? <AccountTab onClose={onClose} onEditProfile={() => setTab('profile')} /> : tab === 'profile' ? <ProfilesTab /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'keybinds' ? <KeybindsTab /> : tab === 'notifications' ? <NotificationsTab /> : tab === 'social' ? <ContentSocialTab /> : tab === 'devices' ? <DevicesTab /> : tab === 'privacy' ? <DataPrivacyTab /> : <VoiceVideoTab />}
    </SettingsShell>
  )
}
