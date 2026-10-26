import { useStore } from '../../store'
import CreateGuildModal from './CreateGuild'
import JoinGuildModal from './JoinGuild'
import CreateChannelModal from './CreateChannel'
import InviteModal from './Invite'
import GuildSettingsModal from './GuildSettings'
import RulesModal from './Rules'
import EventsModal from './Events'
import ChannelSettingsModal from './ChannelSettings'
import UserSettingsModal from './UserSettings'
import NewDmModal from './NewDm'
import ProfileModal from './Profile'
import ConfirmModal from './Confirm'
import ImageLightbox from './ImageLightbox'
import BanMemberModal from './BanMember'
import TimeoutMemberModal from './TimeoutMember'
import EditHistoryModal from './EditHistory'
import ReportModal from './Report'
import CreatePollModal from './CreatePoll'
import EditCategoryModal from './EditCategory'
import CreateThreadModal from './CreateThread'
import NewPostModal from './NewPost'
import TransferOwnershipModal from './TransferOwnership'
import CustomStatusModal from './CustomStatus'
import ForwardModal from './Forward'
import GroupMembersModal from './GroupMembers'
import FolderSettingsModal from './FolderSettings'
import GuildPrivacyModal from './GuildPrivacy'
import LeaveLinkModal from './LeaveLink'
import ShortcutsModal from './Shortcuts'
import QuickSwitcher from './QuickSwitcher'
import NicknameModal from './Nickname'
import ReactionsModal from './Reactions'
import WelcomeModal from './Welcome'
import ModViewModal from './ModView'
import Modal from '../Modal'
import LeaveGroupsModal from './LeaveGroups'
import SafetyCenterModal from './SafetyCenter'
import GuildNotificationsModal from './GuildNotifications'
import AltTextModal from './AltText'
import BrowseChannelsModal from './BrowseChannels'
import OnboardingModal from './Onboarding'
import FollowChannelModal from './FollowChannel'
import ServerProfileModal from './ServerProfile'
import ApplicationModal from './Application'
import ErrorBoundary from '../ErrorBoundary'

export default function Modals() {
  const modal = useStore((s) => s.modal)
  const close = useStore((s) => s.closeModal)
  const pushToast = useStore((s) => s.pushToast)
  if (!modal) return null
  return (
    <ErrorBoundary key={modal.kind} onError={(e) => { pushToast(`Couldn't open that: ${e.message}`, 'error'); close() }} fallback={() => null}>
      {render()}
    </ErrorBoundary>
  )
  function render() {
  switch (modal!.kind) {
    case 'createGuild': return <CreateGuildModal onClose={close} />
    case 'joinGuild': return <JoinGuildModal onClose={close} code={modal!.code} />
    case 'createChannel': return <CreateChannelModal onClose={close} guildId={modal!.guildId} parentId={modal!.parentId ?? null} />
    case 'invite': return <InviteModal onClose={close} guildId={modal!.guildId} />
    case 'guildSettings': return <GuildSettingsModal onClose={close} guildId={modal!.guildId} tab={modal!.tab} />
    case 'channelSettings': return <ChannelSettingsModal onClose={close} channelId={modal!.channelId} tab={modal!.tab} />
    case 'userSettings': return <UserSettingsModal onClose={close} tab={modal!.tab} />
    case 'newDm': return <NewDmModal onClose={close} />
    case 'profile': return <ProfileModal onClose={close} userId={modal!.userId} anchor={modal!.anchor} />
    case 'confirm': return <ConfirmModal onClose={close} {...modal} />
    case 'image': return <ImageLightbox onClose={close} url={modal!.url} name={modal!.name} items={modal!.items} index={modal!.index} />
    case 'ban': return <BanMemberModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} />
    case 'kick': return <BanMemberModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} kick />
    case 'timeout': return <TimeoutMemberModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} />
    case 'editHistory': return <EditHistoryModal onClose={close} channelId={modal!.channelId} messageId={modal!.messageId} />
    case 'report': return <ReportModal onClose={close} messageId={modal!.messageId} userId={modal!.userId} name={modal!.name} guildId={modal!.guildId} server={modal!.server} />
    case 'createPoll': return <CreatePollModal onClose={close} channelId={modal!.channelId} />
    case 'editCategory': return <EditCategoryModal onClose={close} channelId={modal!.channelId} />
    case 'newPost': return <NewPostModal onClose={close} channelId={modal!.channelId} />
    case 'createThread': return <CreateThreadModal onClose={close} channelId={modal!.channelId} messageId={modal!.messageId} suggested={modal!.suggested} />
    case 'transferOwnership': return <TransferOwnershipModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} />
    case 'rules': return <RulesModal onClose={close} guildId={modal!.guildId} />
    case 'events': return <EventsModal onClose={close} guildId={modal!.guildId} />
    case 'customStatus': return <CustomStatusModal onClose={close} />
    case 'forward': return <ForwardModal onClose={close} message={modal!.message} />
    case 'groupMembers': return <GroupMembersModal onClose={close} channelId={modal!.channelId} userIds={modal!.userIds} />
    case 'folderSettings': return <FolderSettingsModal onClose={close} folderId={modal!.folderId} />
    case 'guildPrivacy': return <GuildPrivacyModal onClose={close} guildId={modal!.guildId} />
    case 'leaveLink': return <LeaveLinkModal onClose={close} url={modal!.url} text={modal!.text} />
    case 'shortcuts': return <ShortcutsModal onClose={close} />
    case 'quickSwitcher': return <QuickSwitcher onClose={close} />
    case 'nickname': return <NicknameModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} />
    case 'guildNotifications': return <GuildNotificationsModal onClose={close} guildId={modal!.guildId} />
    case 'safetyCenter': return <SafetyCenterModal onClose={close} />
    case 'leaveGroups': return <LeaveGroupsModal onClose={close} />
    case 'modView': return <ModViewModal onClose={close} guildId={modal!.guildId} userId={modal!.userId} />
    case 'warning': return (
      <Modal title={`A warning from ${modal!.guildName}`} onClose={close} width="max-w-sm" footer={<button className="btn-primary" onClick={close} data-warning-ack>Understood</button>}>
        <p className="text-sm text-text-1" data-warning-reason>{modal!.reason}</p>
        <p className="mt-3 text-xs text-text-2">The server's moderators sent you this. Warnings count toward your account standing for 90 days.</p>
      </Modal>
    )
    case 'welcome': return <WelcomeModal onClose={close} guildId={modal!.guildId} />
    case 'browseChannels': return <BrowseChannelsModal onClose={close} guildId={modal!.guildId} tab={modal!.tab} />
    case 'onboarding': return <OnboardingModal onClose={close} guildId={modal!.guildId} />
    case 'application': return <ApplicationModal onClose={close} guildId={modal!.guildId} />
    case 'serverProfile': return <ServerProfileModal onClose={close} guildId={modal!.guildId} />
    case 'followChannel': return <FollowChannelModal onClose={close} channelId={modal!.channelId} />
    case 'reactions': return <ReactionsModal onClose={close} channelId={modal!.channelId} messageId={modal!.messageId} />
    case 'altText': return <AltTextModal onClose={close} message={modal!.message} />
  }
  }
}
