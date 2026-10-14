import { useStore } from '../../store'
import CreateGuildModal from './CreateGuild'
import JoinGuildModal from './JoinGuild'
import CreateChannelModal from './CreateChannel'
import InviteModal from './Invite'
import GuildSettingsModal from './GuildSettings'
import ChannelSettingsModal from './ChannelSettings'
import UserSettingsModal from './UserSettings'
import NewDmModal from './NewDm'
import ProfileModal from './Profile'
import ConfirmModal from './Confirm'
import ImageLightbox from './ImageLightbox'
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
    case 'createChannel': return <CreateChannelModal onClose={close} guildId={modal!.guildId} />
    case 'invite': return <InviteModal onClose={close} guildId={modal!.guildId} />
    case 'guildSettings': return <GuildSettingsModal onClose={close} guildId={modal!.guildId} tab={modal!.tab} />
    case 'channelSettings': return <ChannelSettingsModal onClose={close} channelId={modal!.channelId} tab={modal!.tab} />
    case 'userSettings': return <UserSettingsModal onClose={close} tab={modal!.tab} />
    case 'newDm': return <NewDmModal onClose={close} />
    case 'profile': return <ProfileModal onClose={close} userId={modal!.userId} />
    case 'confirm': return <ConfirmModal onClose={close} {...modal} />
    case 'image': return <ImageLightbox onClose={close} url={modal!.url} name={modal!.name} />
  }
  }
}
