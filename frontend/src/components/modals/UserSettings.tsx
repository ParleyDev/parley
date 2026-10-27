import { Accessibility, Bell, Download, Blocks, Globe, Keyboard, KeyRound, Link2, Lock, LogOut, MessageSquareText, Mic, Radio, Wrench, MonitorSmartphone, ShieldCheck, Server, Palette, Paintbrush, Pencil, Scissors, Sparkles, Users, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../store'
import AccountTab, { accountSections } from './settings/AccountTab'
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
import SettingsWindow, { type WindowGroup } from './SettingsWindow'
import Avatar from '../Avatar'
import { useT } from '../../lib/i18n'
import { desktopVersion, isDesktop, isNative, switchServer, unregisterPush } from '../../lib/native'
import { APP_NAME, APP_VERSION } from '../../lib/brand'
import { promptInstall, useInstallable } from '../../lib/webpush'

type Tab = 'account' | 'profile' | 'social' | 'privacy' | 'devices' | 'connections' | 'apps' | 'applications' | 'voice' | 'appearance' | 'accessibility' | 'chat' | 'keybinds' | 'notifications' | 'streamer' | 'advanced' | 'language' | 'clips' | 'family'

export default function UserSettingsModal({ onClose, tab: requested }: { onClose: () => void; tab?: Tab }) {
  const initial: Tab = requested ?? 'account'
  const t = useT()
  const [tab, setTab] = useState<Tab>(initial)
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const openModal = useStore((s) => s.openModal)
  const serverVersion = useStore((s) => s.instance.version)
  const installable = useInstallable()
  const foot = 'w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[15px] font-medium hover:bg-bg-3 whitespace-nowrap'
  // Grouped by what you'd go looking for: your account and what others see and can do, how the app looks and
  // behaves, then building on Parley.
  const groups: WindowGroup<Tab>[] = [
    { items: [
      { id: 'account', label: 'Account', icon: <UserIcon size={18} />, keywords: 'display name username email password two-factor 2fa mfa passkeys devices standing age bans year review recap storage delete disable', subs: accountSections() },
      { id: 'profile', label: 'Profiles', icon: <Palette size={18} />, keywords: 'avatar banner bio nameplate decoration frame effect server profile' },
      { id: 'privacy', label: 'Data & Privacy', icon: <Lock size={18} />, keywords: 'export data activity read receipts typing' },
      { id: 'social', label: 'Content & Social', icon: <ShieldCheck size={18} />, keywords: 'messages dms friend requests filter sensitive media spam' },
      { id: 'family', label: 'Family Center', icon: <Users size={18} />, keywords: 'parent teen guardian' },
      { id: 'devices', label: 'Devices', icon: <MonitorSmartphone size={18} />, keywords: 'sessions logged in log out' },
      { id: 'connections', label: 'Connections', icon: <Link2 size={18} />, keywords: 'github twitch spotify steam' },
      { id: 'apps', label: 'Authorized Apps', icon: <KeyRound size={18} />, keywords: 'oauth' },
    ] },
    { title: 'App Settings', items: [
      { id: 'appearance', label: 'Appearance', icon: <Paintbrush size={18} />, keywords: 'theme dark light palette compact font zoom' },
      { id: 'accessibility', label: 'Accessibility', icon: <Accessibility size={18} />, keywords: 'motion contrast saturation captions' },
      { id: 'voice', label: 'Voice & Video', icon: <Mic size={18} />, keywords: 'microphone input output camera noise' },
      { id: 'chat', label: 'Chat', icon: <MessageSquareText size={18} />, keywords: 'emoji embeds stickers gif' },
      { id: 'notifications', label: 'Notifications', icon: <Bell size={18} />, keywords: 'push sounds desktop' },
      { id: 'keybinds', label: 'Keybinds', icon: <Keyboard size={18} />, keywords: 'shortcuts push to talk' },
      { id: 'language', label: 'Language', icon: <Globe size={18} />, keywords: 'locale translate' },
      { id: 'streamer', label: 'Streamer Mode', icon: <Radio size={18} /> },
      { id: 'clips', label: 'Clips', icon: <Scissors size={18} /> },
      { id: 'advanced', label: 'Advanced', icon: <Wrench size={18} />, keywords: 'developer mode hardware acceleration' },
    ] },
    { title: 'Developer', items: [{ id: 'applications', label: 'Applications', icon: <Blocks size={18} />, keywords: 'bots api tokens' }] },
  ]
  const header = user && (
    <div className="flex items-center gap-3 px-1.5 py-1.5" data-settings-me>
      <Avatar user={user} size={40} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-text-0">{user.display_name}</div>
        <button type="button" onClick={() => { onClose(); openModal({ kind: 'editProfile' }) }} className="flex items-center gap-1 text-[13px] text-text-2 hover:text-text-0" data-settings-edit-profiles>{t('Edit Profiles')}<Pencil size={12} /></button>
      </div>
    </div>
  )
  const footer = (
    <>
      <button onClick={() => { onClose(); openModal({ kind: 'whatsNew' }) }} className={`${foot} text-text-1`} data-whats-new-link><span>{t("What's New")}</span><Sparkles size={16} /></button>
      {installable && <button onClick={() => void promptInstall()} className={`${foot} text-text-1`} data-install-app><span>{t('Install app')}</span><Download size={16} /></button>}
      {(isNative() || isDesktop()) && <button onClick={switchServer} className={`${foot} text-text-1`} title={t('Switch server')} data-switch-server><span>{t('Switch server')}</span><Server size={16} /></button>}
      <button onClick={() => { void unregisterPush().finally(() => { onClose(); logout() }) }} className={`${foot} text-danger`} title={t('Log Out')}><span>{t('Log Out')}</span><LogOut size={16} /></button>
      <div className="px-2.5 pt-2 text-[11px] leading-4 text-text-2" data-version>{t('{app} web {version}', { app: APP_NAME, version: APP_VERSION })}{serverVersion ? <><br />{t('server {version}', { version: serverVersion })}</> : null}{isDesktop() ? <><br />{t('desktop {version}', { version: String(desktopVersion()) })}</> : null}</div>
    </>
  )
  return (
    <SettingsWindow<Tab> groups={groups} tab={tab} onTab={setTab} onClose={onClose} title={t('User Settings')} startOnMenu={!requested} header={header} footer={footer}>
      {tab === 'account' ? <AccountTab onDevices={() => setTab('devices')} /> : tab === 'profile' ? <ProfilesTab /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'keybinds' ? <KeybindsTab /> : tab === 'notifications' ? <NotificationsTab /> : tab === 'social' ? <ContentSocialTab /> : tab === 'devices' ? <DevicesTab /> : tab === 'privacy' ? <DataPrivacyTab /> : tab === 'accessibility' ? <AccessibilityTab /> : tab === 'chat' ? <ChatTab /> : tab === 'streamer' ? <StreamerTab /> : tab === 'family' ? <FamilyTab /> : tab === 'clips' ? <ClipsTab /> : tab === 'advanced' ? <AdvancedTab /> : tab === 'language' ? <LanguageTab /> : tab === 'connections' ? <ConnectionsTab /> : tab === 'apps' ? <AuthorizedAppsTab /> : tab === 'applications' ? <ApplicationsTab /> : <VoiceVideoTab />}
    </SettingsWindow>
  )
}
