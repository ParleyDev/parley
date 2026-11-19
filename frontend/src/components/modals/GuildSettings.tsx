import ServerThemeTab from './settings/ServerThemeTab'
import { Award, Blocks, Bot, ChartColumn, ClipboardList, DoorOpen, LayoutTemplate, ListChecks, Flag, PanelsTopLeft, Compass, Crown, ShieldAlert, Gavel, Link2, Music2, ScrollText, Shield, SlidersHorizontal, Smile, Sticker, Tag, Trash2, Users, Palette } from 'lucide-react'
import { useState } from 'react'
import { myGuildPerms, useStore } from '../../store'
import { has, P } from '../../lib/perms'
import SettingsShell from './SettingsShell'
import { guideTopic } from '../../lib/guide'
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
/** The guide's page about each section, for its Help button. */
const HELP: Record<Tab, string> = {
  overview: guideTopic('server-settings#name-icon-and-banner'), theme: guideTopic('server-settings#name-icon-and-banner'), tag: guideTopic('server-settings#name-icon-and-banner'),
  insights: guideTopic('server-settings#name-icon-and-banner'), emoji: guideTopic('server-settings#emoji-stickers-and-sounds'), stickers: guideTopic('server-settings#emoji-stickers-and-sounds'),
  soundboard: guideTopic('server-settings#emoji-stickers-and-sounds'), members: guideTopic('roles-and-permissions#the-member-list'), roles: guideTopic('roles-and-permissions'),
  invites: guideTopic('server-settings#inviting-people'), applications: guideTopic('server-settings#inviting-people'), integrations: guideTopic('apps-and-bots#adding-a-bot-to-your-server'),
  widget: guideTopic('server-settings#getting-found'), badge: guideTopic('server-settings#getting-found'), discovery: guideTopic('server-settings#getting-found'),
  template: guideTopic('server-settings#server-templates'), safety: guideTopic('moderation#safety-setup'), audit: guideTopic('moderation#the-audit-log'),
  bans: guideTopic('moderation#dealing-with-someone'), automod: guideTopic('moderation#automod'), reports: guideTopic('moderation#reports'),
  welcome: guideTopic('server-settings#welcoming-new-members'), onboarding: guideTopic('server-settings#welcoming-new-members'),
}

export default function GuildSettingsModal({ onClose, guildId, tab: requested }: { onClose: () => void; guildId: string; tab?: Tab }) {
  const t = useT()
  const initial: Tab = requested ?? 'overview'
  const guild = useStore((s) => s.guilds[guildId])
  const user = useStore((s) => s.user)
  const perms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const canOverview = has(perms, P.MANAGE_GUILD)
  const canBans = has(perms, P.BAN_MEMBERS)
  // Members and Roles are gated here as well as at the entry.
  const canPeople = canOverview || has(perms, P.MANAGE_ROLES)
  const canAudit = canOverview || has(perms, P.VIEW_AUDIT_LOG)
  const canExpr = canOverview || has(perms, P.MANAGE_EXPRESSIONS)
  const canReview = canOverview || has(perms, P.KICK_MEMBERS)
  const canReports = canOverview || has(perms, P.MANAGE_MESSAGES) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.MODERATE_MEMBERS)
  const allowed = (x: Tab) => !(((x === 'overview' || x === 'theme' || x === 'tag' || x === 'safety' || x === 'automod' || x === 'welcome' || x === 'onboarding' || x === 'template' || x === 'insights' || x === 'integrations' || x === 'widget' || x === 'invites' || x === 'badge' || x === 'discovery') && !canOverview) || ((x === 'emoji' || x === 'stickers' || x === 'soundboard') && !canExpr) || (x === 'audit' && !canAudit) || (x === 'bans' && !canBans) || (x === 'applications' && !canReview) || (x === 'reports' && !canReports) || ((x === 'roles' || x === 'members') && !canPeople))
  const [tab, setTab] = useState<Tab>(allowed(initial) ? initial : (['roles', 'members'] as Tab[]).find(allowed) ?? 'roles')
  if (!guild) return null
  const isOwner = guild.owner_id === user?.id

  const del = () => openModal({ kind: 'deleteServer', guildId })

  // Grouped like Discord's server settings: the server, Expression, People, Apps, Moderation, Community.
  type Item = { id: Tab; label: string; icon: React.ReactNode; keywords?: string }
  const sec = (title: string | undefined, list: (Item | false)[]) => ({ title, items: list.filter((x): x is Item => !!x) })
  const sections = [
    sec(guild.name, [canOverview && { id: 'overview', label: 'Server Profile', icon: <SlidersHorizontal size={18} />, keywords: 'name icon description banner system messages welcome channel inactive afk timeout default notifications rules' }, canOverview && { id: 'theme', label: 'Server Theme', icon: <Palette size={18} />, keywords: 'colour color gradient appearance' }, canOverview && { id: 'tag', label: 'Server Tag', icon: <Tag size={18} />, keywords: 'clan badge guild tag' }, canOverview && { id: 'insights', label: 'Insights', icon: <ChartColumn size={18} />, keywords: 'analytics stats statistics growth engagement' }]),
    sec('Expression', [canExpr && { id: 'emoji', label: 'Emoji', icon: <Smile size={18} />, keywords: 'emojis upload custom expression' }, canExpr && { id: 'stickers', label: 'Stickers', icon: <Sticker size={18} />, keywords: 'sticker upload expression' }, canExpr && { id: 'soundboard', label: 'Soundboard', icon: <Music2 size={18} />, keywords: 'sounds audio clips' }]),
    sec('People', [canPeople && { id: 'members', label: 'Members', icon: <Users size={18} />, keywords: 'people prune kick ban timeout nickname filter' }, canPeople && { id: 'roles', label: 'Roles', icon: <Shield size={18} />, keywords: 'permissions colour color icon hoist mention admin moderator' }, canOverview && { id: 'invites', label: 'Invites', icon: <Link2 size={18} />, keywords: 'invite link expire uses vanity' }, canReview && { id: 'applications', label: 'Access', icon: <ClipboardList size={18} />, keywords: 'apply application join requests questions membership screening rules' }]),
    sec('Apps', [canOverview && { id: 'integrations', label: 'Integrations', icon: <Blocks size={18} />, keywords: 'webhooks bots apps twitch youtube follow' }, canOverview && { id: 'widget', label: 'Widget', icon: <PanelsTopLeft size={18} />, keywords: 'embed html invite' }, canOverview && { id: 'badge', label: 'Badge', icon: <Award size={18} />, keywords: 'emblem' }]),
    sec('Moderation', [canOverview && { id: 'safety', label: 'Safety Setup', icon: <ShieldAlert size={18} />, keywords: 'verification level raid protection dm spam explicit image filter mfa 2fa security pause invites' }, canAudit && { id: 'audit', label: 'Audit Log', icon: <ScrollText size={18} />, keywords: 'log history actions changes' }, canBans && { id: 'bans', label: 'Bans', icon: <Gavel size={18} />, keywords: 'banned unban' }, canOverview && { id: 'automod', label: 'AutoMod', icon: <Bot size={18} />, keywords: 'filter words links mention spam regex keyword block rules' }, canReports && { id: 'reports', label: 'Reports', icon: <Flag size={18} />, keywords: 'reported messages moderation queue' }]),
    sec('Community', [canOverview && { id: 'welcome', label: 'Welcome Screen', icon: <DoorOpen size={18} />, keywords: 'greeting new members' }, canOverview && { id: 'onboarding', label: 'Onboarding', icon: <ListChecks size={18} />, keywords: 'questions prompts default channels customize' }, canOverview && { id: 'discovery', label: 'Discovery', icon: <Compass size={18} />, keywords: 'public listing category explore' }]),
    sec(undefined, [canOverview && { id: 'template', label: 'Server Template', icon: <LayoutTemplate size={18} />, keywords: 'copy clone' }]),
  ].filter((x) => x.items.length)

  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} wide={tab !== 'overview'} title="Server Settings" startOnMenu={!requested} help={HELP[tab]}
      sections={sections}
      footer={isOwner ? (
        <div className="space-y-1">
          <button onClick={() => openModal({ kind: 'transferOwnership', guildId })} className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[15px] font-medium text-text-1 hover:bg-bg-3 whitespace-nowrap" title={t('Transfer Ownership')}><span>{t('Transfer Ownership')}</span><Crown size={16} /></button>
          <button onClick={del} className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[15px] font-medium text-danger hover:bg-bg-3 whitespace-nowrap" title={t('Delete Server')}><span>{t('Delete Server')}</span><Trash2 size={16} /></button>
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
      {tab === 'roles' && canPeople && <RolesTab guildId={guildId} />}
      {tab === 'members' && canPeople && <MembersTab guildId={guildId} />}
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
