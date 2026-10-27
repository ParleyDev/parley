import { Accessibility, Bell, Download, Blocks, Globe, Keyboard, KeyRound, Link2, Lock, LogOut, MessageSquareText, Mic, Radio, Wrench, MonitorSmartphone, ShieldCheck, Server, Palette, Paintbrush, Scissors, Sparkles, Users, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../store'
import AccountTab from './settings/AccountTab'
import VoiceVideoTab from './settings/VoiceVideoTab'
import ProfilesTab from './settings/ProfilesTab'
import ClipsTab from './settings/ClipsTab'
import FamilyTab from './settings/FamilyTab'
import AppearanceTab from './settings/AppearanceTab'
import KeybindsTab from './settings/KeybindsTab'
import NotificationsTab from './settings/NotificationsTab'
import ContentSocialTab from './settings/ContentSocialTab'
import DevicesTab from './settings/DevicesTab'
import DataPrivacyTab from './settings/DataPrivacyTab'
import AccessibilityTab from './settings/AccessibilityTab'
import ChatTab from './settings/ChatTab'
import StreamerTab from './settings/StreamerTab'
import AdvancedTab from './settings/AdvancedTab'
import LanguageTab from './settings/LanguageTab'
import ConnectionsTab from './settings/ConnectionsTab'
import AuthorizedAppsTab from './settings/AuthorizedAppsTab'
import ApplicationsTab from './settings/ApplicationsTab'
import SettingsShell from './SettingsShell'
import { useT } from '../../lib/i18n'
import { desktopVersion, isDesktop, isNative, switchServer, unregisterPush } from '../../lib/native'
import { APP_NAME, APP_VERSION } from '../../lib/brand'
import { promptInstall, useInstallable } from '../../lib/webpush'

type Tab = 'account' | 'profile' | 'social' | 'privacy' | 'devices' | 'connections' | 'apps' | 'applications' | 'voice' | 'appearance' | 'accessibility' | 'chat' | 'keybinds' | 'notifications' | 'streamer' | 'advanced' | 'language' | 'clips' | 'family'

export default function UserSettingsModal({ onClose, tab: requested }: { onClose: () => void; tab?: Tab }) {
  const initial: Tab = requested ?? 'account'
  const t = useT()
  const [tab, setTab] = useState<Tab>(initial)
  const logout = useStore((s) => s.logout)
  const serverVersion = useStore((s) => s.instance.version)
  const installable = useInstallable()
  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} title={t('User Settings')} startOnMenu={!requested}
      sections={[
        { title: t('User Settings'), items: [{ id: 'account', label: t('My Account'), icon: <UserIcon size={16} /> }, { id: 'profile', label: t('Profiles'), icon: <Palette size={16} /> }, { id: 'social', label: t('Content & Social'), icon: <ShieldCheck size={16} /> }, { id: 'privacy', label: t('Data & Privacy'), icon: <Lock size={16} /> }, { id: 'devices', label: t('Devices'), icon: <MonitorSmartphone size={16} /> }, { id: 'connections', label: t('Connections'), icon: <Link2 size={16} /> }, { id: 'apps', label: t('Authorized Apps'), icon: <KeyRound size={16} /> }, { id: 'family', label: t('Family Center'), icon: <Users size={16} /> }] },
        { title: t('Developer'), items: [{ id: 'applications', label: t('Applications'), icon: <Blocks size={16} /> }] },
        { title: t('App Settings'), items: [{ id: 'appearance', label: t('Appearance'), icon: <Paintbrush size={16} /> }, { id: 'accessibility', label: t('Accessibility'), icon: <Accessibility size={16} /> }, { id: 'voice', label: t('Voice & Video'), icon: <Mic size={16} /> }, { id: 'chat', label: t('Chat'), icon: <MessageSquareText size={16} /> }, { id: 'notifications', label: t('Notifications'), icon: <Bell size={16} /> }, { id: 'keybinds', label: t('Keybinds'), icon: <Keyboard size={16} /> }, { id: 'language', label: t('Language'), icon: <Globe size={16} /> }, { id: 'streamer', label: t('Streamer Mode'), icon: <Radio size={16} /> }, { id: 'clips', label: t('Clips'), icon: <Scissors size={16} /> }, { id: 'advanced', label: t('Advanced'), icon: <Wrench size={16} /> }] },
      ]}
      footer={<><div className="px-2.5 pb-2 text-[11px] leading-4 text-text-2" data-version>{t('{app} web {version}', { app: APP_NAME, version: APP_VERSION })}{serverVersion ? <><br />{t('server {version}', { version: serverVersion })}</> : null}{isDesktop() ? <><br />{t('desktop {version}', { version: String(desktopVersion()) })}</> : null}</div><button onClick={() => { onClose(); useStore.getState().openModal({ kind: 'whatsNew' }) }} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 whitespace-nowrap" data-whats-new-link><span>{t("What's New")}</span><Sparkles size={16} /></button>{installable && <button onClick={() => void promptInstall()} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 whitespace-nowrap" data-install-app><span>{t('Install app')}</span><Download size={16} /></button>}<button onClick={() => { void unregisterPush().finally(() => { onClose(); logout() }) }} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title={t('Log Out')}><span>{t('Log Out')}</span><LogOut size={16} /></button>{(isNative() || isDesktop()) && <button onClick={switchServer} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 whitespace-nowrap" title={t('Switch server')} data-switch-server><span>{t('Switch server')}</span><Server size={16} /></button>}</>}
    >
      {tab === 'account' ? <AccountTab onClose={onClose} onEditProfile={() => { onClose(); useStore.getState().openModal({ kind: 'editProfile' }) }} /> : tab === 'profile' ? <ProfilesTab /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'keybinds' ? <KeybindsTab /> : tab === 'notifications' ? <NotificationsTab /> : tab === 'social' ? <ContentSocialTab /> : tab === 'devices' ? <DevicesTab /> : tab === 'privacy' ? <DataPrivacyTab /> : tab === 'accessibility' ? <AccessibilityTab /> : tab === 'chat' ? <ChatTab /> : tab === 'streamer' ? <StreamerTab /> : tab === 'family' ? <FamilyTab /> : tab === 'clips' ? <ClipsTab /> : tab === 'advanced' ? <AdvancedTab /> : tab === 'language' ? <LanguageTab /> : tab === 'connections' ? <ConnectionsTab /> : tab === 'apps' ? <AuthorizedAppsTab /> : tab === 'applications' ? <ApplicationsTab /> : <VoiceVideoTab />}
    </SettingsShell>
  )
}
