import ServerThemeTab from './settings/ServerThemeTab'
import { Award, Blocks, Bot, ChartColumn, ClipboardList, DoorOpen, LayoutTemplate, ListChecks, Flag, PanelsTopLeft, Compass, Crown, ShieldAlert, Gavel, Link2, Music2, ScrollText, Shield, SlidersHorizontal, Smile, Sticker, Tag, Trash2, Users, Palette } from 'lucide-react'
import { useState } from 'react'
import { myGuildPerms, useStore } from '../../store'
import { has, P } from '../../lib/perms'
import SettingsShell from './SettingsShell'
import { useT } from '../../lib/i18n'
import GuildOverviewTab from './settings/GuildOverviewTab'
import RolesTab from './settings/RolesTab'
import MembersTab from './settings/MembersTab'
import BansTab from './settings/BansTab'
import EmojiTab from './settings/EmojiTab'
import StickersTab from './settings/StickersTab'
import SoundboardTab from './settings/SoundboardTab'
import DiscoveryTab from './settings/DiscoveryTab'
import AuditLogTab from './settings/AuditLogTab'
import InvitesTab from './settings/InvitesTab'
import BadgeTab from './settings/BadgeTab'
import SafetyTab from './settings/SafetyTab'
import WelcomeTab from './settings/WelcomeTab'
import WidgetTab from './settings/WidgetTab'
import ReportsTab from './settings/ReportsTab'
import AutomodTab from './settings/AutomodTab'
import OnboardingTab from './settings/OnboardingTab'
import TemplateTab from './settings/TemplateTab'
import MemberApplicationsTab from './settings/MemberApplicationsTab'
import InsightsTab from './settings/InsightsTab'
import IntegrationsTab from './settings/IntegrationsTab'
import ServerTagTab from './settings/ServerTagTab'

type Tab = 'overview' | 'theme' | 'tag' | 'safety' | 'automod' | 'welcome' | 'onboarding' | 'template' | 'applications' | 'insights' | 'integrations' | 'widget' | 'reports' | 'roles' | 'members' | 'invites' | 'badge' | 'bans' | 'emoji' | 'stickers' | 'soundboard' | 'discovery' | 'audit'

export default function GuildSettingsModal({ onClose, guildId, tab: requested }: { onClose: () => void; guildId: string; tab?: Tab }) {
  const t = useT()
  const initial: Tab = requested ?? 'overview'
  const guild = useStore((s) => s.guilds[guildId])
  const user = useStore((s) => s.user)
  const perms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const canOverview = has(perms, P.MANAGE_GUILD)
  const canBans = has(perms, P.BAN_MEMBERS)
  const canAudit = canOverview || has(perms, P.VIEW_AUDIT_LOG)
  const canExpr = canOverview || has(perms, P.MANAGE_EXPRESSIONS)
  const canReview = canOverview || has(perms, P.KICK_MEMBERS)
  const canReports = canOverview || has(perms, P.MANAGE_MESSAGES) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.MODERATE_MEMBERS)
  const [tab, setTab] = useState<Tab>(((initial === 'overview' || initial === 'tag' || initial === 'safety' || initial === 'automod' || initial === 'welcome' || initial === 'onboarding' || initial === 'template' || initial === 'insights' || initial === 'integrations' || initial === 'widget' || initial === 'invites' || initial === 'badge' || initial === 'discovery') && !canOverview) || ((initial === 'emoji' || initial === 'stickers') && !canExpr) || (initial === 'audit' && !canAudit) || (initial === 'bans' && !canBans) ? 'roles' : initial)
  if (!guild) return null
  const isOwner = guild.owner_id === user?.id

  const del = () => openModal({ kind: 'deleteServer', guildId })

  // Grouped like Discord's server settings: the server, Expression, People, Apps, Moderation, Community.
  type Item = { id: Tab; label: string; icon: React.ReactNode }
  const sec = (title: string | undefined, list: (Item | false)[]) => ({ title, items: list.filter((x): x is Item => !!x) })
  const sections = [
    sec(guild.name, [canOverview && { id: 'overview', label: 'Server Profile', icon: <SlidersHorizontal size={16} /> }, canOverview && { id: 'theme', label: 'Server Theme', icon: <Palette size={16} /> }, canOverview && { id: 'tag', label: 'Server Tag', icon: <Tag size={16} /> }, canOverview && { id: 'insights', label: 'Insights', icon: <ChartColumn size={16} /> }]),
    sec('Expression', [canExpr && { id: 'emoji', label: 'Emoji', icon: <Smile size={16} /> }, canExpr && { id: 'stickers', label: 'Stickers', icon: <Sticker size={16} /> }, canExpr && { id: 'soundboard', label: 'Soundboard', icon: <Music2 size={16} /> }]),
    sec('People', [{ id: 'members', label: 'Members', icon: <Users size={16} /> }, { id: 'roles', label: 'Roles', icon: <Shield size={16} /> }, canOverview && { id: 'invites', label: 'Invites', icon: <Link2 size={16} /> }, canReview && { id: 'applications', label: 'Access', icon: <ClipboardList size={16} /> }]),
    sec('Apps', [canOverview && { id: 'integrations', label: 'Integrations', icon: <Blocks size={16} /> }, canOverview && { id: 'widget', label: 'Widget', icon: <PanelsTopLeft size={16} /> }, canOverview && { id: 'badge', label: 'Badge', icon: <Award size={16} /> }]),
    sec('Moderation', [canOverview && { id: 'safety', label: 'Safety Setup', icon: <ShieldAlert size={16} /> }, canAudit && { id: 'audit', label: 'Audit Log', icon: <ScrollText size={16} /> }, canBans && { id: 'bans', label: 'Bans', icon: <Gavel size={16} /> }, canOverview && { id: 'automod', label: 'AutoMod', icon: <Bot size={16} /> }, canReports && { id: 'reports', label: 'Reports', icon: <Flag size={16} /> }]),
    sec('Community', [canOverview && { id: 'welcome', label: 'Welcome Screen', icon: <DoorOpen size={16} /> }, canOverview && { id: 'onboarding', label: 'Onboarding', icon: <ListChecks size={16} /> }, canOverview && { id: 'discovery', label: 'Discovery', icon: <Compass size={16} /> }]),
    sec(undefined, [canOverview && { id: 'template', label: 'Server Template', icon: <LayoutTemplate size={16} /> }]),
  ].filter((x) => x.items.length)

  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} wide={tab !== 'overview'} title="Server Settings" startOnMenu={!requested}
      sections={sections}
      footer={isOwner ? (
        <div className="flex flex-col phone:flex-row gap-0.5">
          <button onClick={() => openModal({ kind: 'transferOwnership', guildId })} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-text-1 hover:bg-bg-3 hover:text-text-0 whitespace-nowrap" title={t('Transfer Ownership')}><span>{t('Transfer Ownership')}</span><Crown size={16} /></button>
          <button onClick={del} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title={t('Delete Server')}><span>{t('Delete Server')}</span><Trash2 size={16} /></button>
        </div>
      ) : undefined}
    >
      {tab === 'overview' && canOverview && <GuildOverviewTab guildId={guildId} />}
      {tab === 'theme' && canOverview && <ServerThemeTab guildId={guildId} />}
      {tab === 'tag' && canOverview && <ServerTagTab guildId={guildId} onTab={(x) => setTab(x)} />}
      {tab === 'safety' && canOverview && <SafetyTab guildId={guildId} />}
      {tab === 'automod' && canOverview && <AutomodTab guildId={guildId} />}
      {tab === 'welcome' && canOverview && <WelcomeTab guildId={guildId} />}
      {tab === 'onboarding' && canOverview && <OnboardingTab guildId={guildId} />}
      {tab === 'template' && canOverview && <TemplateTab guildId={guildId} />}
      {tab === 'insights' && canOverview && <InsightsTab guildId={guildId} />}
      {tab === 'integrations' && canOverview && <IntegrationsTab guildId={guildId} />}
      {tab === 'applications' && canReview && <MemberApplicationsTab guildId={guildId} />}
      {tab === 'widget' && canOverview && <WidgetTab guildId={guildId} />}
      {tab === 'roles' && <RolesTab guildId={guildId} />}
      {tab === 'members' && <MembersTab guildId={guildId} />}
      {tab === 'invites' && canOverview && <InvitesTab guildId={guildId} onDiscovery={() => setTab('discovery')} onBadge={() => setTab('badge')} />}
      {tab === 'badge' && canOverview && <BadgeTab guildId={guildId} onInvites={() => setTab('invites')} />}
      {tab === 'bans' && canBans && <BansTab guildId={guildId} />}
      {tab === 'emoji' && canExpr && <EmojiTab guildId={guildId} />}
      {tab === 'stickers' && canExpr && <StickersTab guildId={guildId} />}
      {tab === 'soundboard' && canExpr && <SoundboardTab guildId={guildId} />}
      {tab === 'discovery' && canOverview && <DiscoveryTab guildId={guildId} />}
      {tab === 'audit' && canAudit && <AuditLogTab guildId={guildId} />}
      {tab === 'reports' && canReports && <ReportsTab guildId={guildId} />}
    </SettingsShell>
  )
}
