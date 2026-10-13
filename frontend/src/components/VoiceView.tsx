import { Volume2 } from 'lucide-react'
import type { Channel } from '../lib/types'

export default function VoiceView({ channel }: { channel: Channel }) {
  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-0">
      <header className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-line"><Volume2 size={22} className="text-text-2" /><span className="font-bold">{channel.name}</span></header>
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="h-20 w-20 rounded-full bg-bg-3 flex items-center justify-center mb-4"><Volume2 size={36} className="text-text-1" /></div>
        <h2 className="text-2xl font-bold">{channel.name}</h2>
        <p className="text-text-2 mt-2 max-w-sm">Voice chat isn't wired up in this build. Voice channels are listed for parity; text channels are fully functional.</p>
      </div>
    </main>
  )
}
