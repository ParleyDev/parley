import { PlusCircle, SendHorizontal, Smile, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { sendTyping } from '../lib/ws'
import type { Channel, DmChannel, Message } from '../lib/types'

const QUICK_EMOJI = ['😀', '😂', '😍', '🔥', '👍', '🎉', '😢', '🤔', '👀', '❤️', '🚀', '✨', '💯', '🙏', '😎', '🥳']

interface Props { channel: Channel | DmChannel; reply: Message | null; onCancelReply: () => void; onSent: () => void }

export default function Composer({ channel, reply, onCancelReply, onSent }: Props) {
  const sendMessage = useStore((s) => s.sendMessage)
  const pushToast = useStore((s) => s.pushToast)
  const typing = useStore((s) => s.typing[channel.id])
  const users = useStore((s) => s.users)
  const canSend = useStore((s) => has(myChannelPerms(s, channel.id), P.SEND_MESSAGES))
  const [value, setValue] = useState('')
  const [emoji, setEmoji] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)
  const isDm = channel.guild_id === null
  const name = isDm ? `@${(channel as DmChannel).recipients[0]?.display_name ?? ''}` : (channel as Channel).kind === 'voice' ? channel.name : `#${channel.name}`

  useEffect(() => { ref.current?.focus() }, [channel.id, reply])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 300) + 'px'
  }, [value])

  const submit = async () => {
    const content = value.trim()
    if (!content) return
    setValue('')
    onCancelReply()
    try { await sendMessage(channel.id, content, reply?.id); onSent() } catch (e) { pushToast((e as Error).message, 'error'); setValue(content) }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    if (e.key === 'Escape' && reply) onCancelReply()
  }
  const onChange = (v: string) => {
    setValue(v)
    const now = Date.now()
    if (v && now - lastTyping.current > 4000) { lastTyping.current = now; sendTyping(channel.id) }
  }

  const typers = Object.keys(typing ?? {}).map((id) => users[id]?.display_name ?? 'Someone')

  if (!canSend) {
    return (
      <div className="shrink-0 px-4 pb-6 pt-1 max-md:px-2 max-md:pb-2">
        <div className="rounded-xl bg-bg-3/60 border border-line px-4 py-3 text-[15px] text-text-2">You do not have permission to send messages in this channel.</div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="shrink-0 px-4 pb-6 pt-1 max-md:px-2 max-md:pb-2">
      <div className="rounded-xl bg-bg-3 border border-line focus-within:border-accent/50 transition">
        {reply && (
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-text-1 border-b border-line bg-bg-4/40 rounded-t-xl">
            <span>Replying to <b className="text-text-0">{reply.author.display_name}</b></span>
            <button onClick={onCancelReply} className="text-text-2 hover:text-text-0"><X size={14} /></button>
          </div>
        )}
        <div className="flex items-end gap-2 px-3 py-2">
          <button className="text-text-2 hover:text-text-0 pb-1" title="Attachments are not supported yet" onClick={() => pushToast('File uploads are not supported yet')}><PlusCircle size={22} /></button>
          <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={`Message ${name}`}
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-text-2 max-h-[300px]" maxLength={2000} />
          <div className="relative pb-1">
            <button className="text-text-2 hover:text-warn" onClick={() => setEmoji((e) => !e)} title="Emoji"><Smile size={22} /></button>
            {emoji && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setEmoji(false)} />
                <div className="pop absolute bottom-full right-0 mb-3 z-40 grid grid-cols-8 gap-1 rounded-xl bg-bg-0 border border-line p-2 shadow-2xl">
                  {QUICK_EMOJI.map((e) => <button key={e} onClick={() => { setValue((v) => v + e); setEmoji(false); ref.current?.focus() }} className="h-8 w-8 rounded-md text-xl hover:bg-bg-3">{e}</button>)}
                </div>
              </>
            )}
          </div>
          <button onClick={submit} disabled={!value.trim()} className="text-accent disabled:text-text-2 pb-1 hover:text-accent-hover" title="Send"><SendHorizontal size={22} /></button>
        </div>
      </div>
      <div className="h-5 px-1 pt-1 text-xs text-text-1 flex items-center gap-1.5">
        {typers.length > 0 && (
          <>
            <span className="flex gap-0.5"><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /></span>
            <span><b>{typers.slice(0, 3).join(', ')}</b> {typers.length > 3 ? 'and others are' : typers.length === 1 ? 'is' : 'are'} typing…</span>
          </>
        )}
      </div>
    </div>
  )
}
