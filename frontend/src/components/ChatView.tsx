import { Hash } from 'lucide-react'
import type { Channel, DmChannel } from '../lib/types'
import Avatar from './Avatar'
import ChatPane from './ChatPane'
import { MembersToggle, MobileBack } from './HeaderBits'

export default function ChatView({ channel }: { channel: Channel | DmChannel }) {
  const isDm = channel.guild_id === null
  const other = isDm ? (channel as DmChannel).recipients[0] : null

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
      <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line shadow-sm">
        <MobileBack />
        {isDm && other ? (
          <><Avatar user={other} size={24} presence /><span className="font-bold truncate">{other.display_name}</span><span className="text-text-2 text-sm max-md:hidden">@{other.username}</span></>
        ) : (
          <>
            <Hash size={22} className="text-text-2 shrink-0" />
            <span className="font-bold truncate">{channel.name}</span>
            {channel.topic && <><span className="mx-2 h-6 w-px bg-line max-md:hidden" /><span className="text-sm text-text-2 truncate max-md:hidden">{channel.topic}</span></>}
          </>
        )}
        {!isDm && <span className="ml-auto"><MembersToggle /></span>}
      </header>
      <ChatPane channel={channel} />
    </main>
  )
}
