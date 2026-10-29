import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store'
import type { DmChannel, Message, User } from '../../lib/types'
import ChatPane from '../ChatPane'
import Avatar from '../Avatar'

/**
 * Development only (/dev/chat-sim, built when VITE_DEV_TOOLS=1 or in `vite dev`): two fake DMs with 500 messages
 * each, served from memory a page of 50 at a time, and buttons for the things that move a chat around: incoming
 * messages, an image that arrives two seconds after its message, and older pages. Nothing reaches the server except
 * read marks and receipts for the fake ids, which fail quietly.
 */
const TOTAL = 500
const PAGE = 50
const DELAY = 300

let seq = 0
/** Ids sort like the server's (uuid v7: time first), unique within the page. */
const simId = (ms: number) => { const hex = Math.floor(ms).toString(16).padStart(12, '0'); const n = (seq++).toString(16).padStart(12, '0'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-${n}` }
const LINES = [
  'hey, are you around?', 'yeah what\'s up', 'did you see the new build', 'not yet, is it out?',
  'just shipped it this morning. the call screen on phones is a lot better now and the keyboard stops jumping around when you open it',
  'nice', 'trying it now', 'ok it works on my phone too 🎉', 'lunch?', 'sure, 20 minutes',
  'a longer one to make some rows taller than others: it wraps onto a second line at desktop width and onto three or four lines on a phone, which is what the windowing has to measure',
]

function friendOf(me: User, n: number): User {
  return { ...me, id: `00000000-0000-7000-8000-00000000000${n}`, username: n === 1 ? 'simfriend' : 'simother', display_name: n === 1 ? 'Sim Friend' : 'Other Sim', avatar_url: null, bot: false, system: false } as User
}

function makeHistory(ch: string, me: User, friend: User): Message[] {
  const start = Date.now() - TOTAL * 3 * 60_000
  const out: Message[] = []
  for (let i = 0; i < TOTAL; i++) {
    const at = start + i * 3 * 60_000 + (i % 3) * 20_000
    const sys = i % 37 === 36
    const author = sys || (i >> 2) % 2 ? friend : me
    out.push({
      id: simId(at), channel_id: ch, author, created_at: new Date(at).toISOString(), edited_at: null, pinned_at: null, reply_to: null, reactions: [], attachments: [],
      content: sys ? (i % 2 ? 'turned on end-to-end encryption for calls.' : 'started a call.') : `${LINES[i % LINES.length]} (#${i + 1})`,
      kind: sys ? (i % 2 ? 'call_e2ee_change' : 'call_ended') : 'default',
    } as Message)
  }
  return out
}

const pic = (): string => {
  const c = document.createElement('canvas'); c.width = 480; c.height = 320
  const g = c.getContext('2d')!
  const gr = g.createLinearGradient(0, 0, 480, 320); gr.addColorStop(0, '#5865f2'); gr.addColorStop(1, '#eb459e')
  g.fillStyle = gr; g.fillRect(0, 0, 480, 320); g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText('loaded after 2s', 90, 175)
  return c.toDataURL('image/png')
}

export default function ChatSim() {
  const me = useStore((s) => s.user)
  const [active, setActive] = useState<'sim-dm-a' | 'sim-dm-b'>('sim-dm-a')
  const data = useRef<Record<string, Message[]>>({})
  const [ready, setReady] = useState(false)
  const [stats, setStats] = useState('')

  useEffect(() => {
    if (!me) return
    const friends = [friendOf(me, 1), friendOf(me, 2)]
    const dms: Record<string, DmChannel> = {}
    ;(['sim-dm-a', 'sim-dm-b'] as const).forEach((id, i) => {
      dms[id] = { id, guild_id: null, kind: 'dm', name: '', recipients: [friends[i]], last_message_at: null, owner_id: null, icon_url: null, request_state: 'accepted', position: 0, topic: null, parent_id: null, e2ee: true } as unknown as DmChannel
      data.current[id] = makeHistory(id, me, friends[i])
    })
    const st = useStore.getState()
    const orig = { loadMessages: st.loadMessages, loadLatest: st.loadLatest, loadNewer: st.loadNewer, loadAround: st.loadAround, sendMessage: st.sendMessage }
    const sim = (ch: string) => ch.startsWith('sim-dm-')
    const wait = () => new Promise((r) => setTimeout(r, DELAY))
    useStore.setState({
      dms: { ...st.dms, ...dms },
      // Read up to the end, so the chats open at the bottom rather than at a NEW line near the top.
      readStates: { ...st.readStates, 'sim-dm-a': data.current['sim-dm-a'].at(-1)!.id, 'sim-dm-b': data.current['sim-dm-b'].at(-1)!.id },
      loadMessages: async (ch, before) => {
        if (!sim(ch)) return orig.loadMessages(ch, before)
        const s = useStore.getState()
        if (s.loadingMessages[ch] || (before && s.hasMore[ch] === false)) return
        s.setLoadingMessages(ch, true)
        await wait()
        const all = data.current[ch]
        const end = before ? all.findIndex((m) => m.id === before) : all.length
        const page = all.slice(Math.max(0, end - PAGE), end)
        useStore.getState().prependMessages(ch, page, end - PAGE > 0)
        useStore.getState().setLoadingMessages(ch, false)
      },
      loadLatest: async (ch) => {
        if (!sim(ch)) return orig.loadLatest(ch)
        const all = data.current[ch]
        useStore.setState((s) => ({ messages: { ...s.messages, [ch]: all.slice(-PAGE) }, hasMore: { ...s.hasMore, [ch]: true }, hasNewer: { ...s.hasNewer, [ch]: false } }))
      },
      loadNewer: async (ch) => {
        if (!sim(ch)) return orig.loadNewer(ch)
        const s = useStore.getState(); const cur = s.messages[ch] ?? []
        const all = data.current[ch]; const at = all.findIndex((m) => m.id === cur[cur.length - 1]?.id)
        const more = all.slice(at + 1, at + 1 + PAGE)
        useStore.setState((st2) => ({ messages: { ...st2.messages, [ch]: [...cur, ...more] }, hasNewer: { ...st2.hasNewer, [ch]: at + 1 + PAGE < all.length } }))
      },
      loadAround: async (ch, anchor) => {
        if (!sim(ch)) return orig.loadAround(ch, anchor)
        const all = data.current[ch]; const i = Math.max(0, all.findIndex((m) => m.id >= anchor))
        useStore.setState((s) => ({ messages: { ...s.messages, [ch]: all.slice(Math.max(0, i - 25), i + 25) }, hasMore: { ...s.hasMore, [ch]: i > 25 }, hasNewer: { ...s.hasNewer, [ch]: i + 25 < all.length } }))
      },
      sendMessage: async (ch, content, replyTo, ...rest) => {
        if (!sim(ch)) return orig.sendMessage(ch, content, replyTo, ...rest)
        await wait()
        const m = { id: simId(Date.now()), channel_id: ch, author: me, content, created_at: new Date().toISOString(), edited_at: null, pinned_at: null, reply_to: replyTo ?? null, reactions: [], attachments: [], kind: 'default' } as Message
        data.current[ch].push(m)
        useStore.getState().addMessage(m)
      },
    })
    setReady(true)
    return () => {
      useStore.setState((s) => {
        const rest = { ...s.dms }; delete rest['sim-dm-a']; delete rest['sim-dm-b']
        const msgs = { ...s.messages }; delete msgs['sim-dm-a']; delete msgs['sim-dm-b']
        return { ...orig, dms: rest, messages: msgs }
      })
    }
  }, [me])

  // Live numbers for the checks: rows in the DOM, distance from the bottom.
  useEffect(() => {
    const id = setInterval(() => {
      const el = document.querySelector<HTMLElement>('[data-message-list]')
      if (!el) return
      const loaded = useStore.getState().messages[active]?.length ?? 0
      setStats(`${loaded} loaded · ${el.querySelectorAll('[data-row-id]').length} in DOM · ${Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)}px from bottom`)
    }, 250)
    return () => clearInterval(id)
  }, [active])

  const friend = (ch: string) => useStore.getState().dms[ch]?.recipients[0]
  const incoming = (n: number) => {
    for (let i = 0; i < n; i++) {
      const m = { id: simId(Date.now() + i), channel_id: active, author: friend(active)!, content: `incoming ${new Date().toLocaleTimeString()} (${i + 1}/${n})`, created_at: new Date().toISOString(), edited_at: null, pinned_at: null, reply_to: null, reactions: [], attachments: [], kind: 'default' } as Message
      data.current[active].push(m)
      useStore.getState().addMessage(m)
    }
  }
  const delayedImage = () => {
    const ch = active
    const m = { id: simId(Date.now()), channel_id: ch, author: friend(ch)!, content: 'here is the screenshot', created_at: new Date().toISOString(), edited_at: null, pinned_at: null, reply_to: null, reactions: [], attachments: [], kind: 'default' } as Message
    data.current[ch].push(m)
    useStore.getState().addMessage(m)
    setTimeout(() => {
      const withImage = { ...m, attachments: [{ id: `sim-att-${m.id}`, filename: 'screenshot.png', content_type: 'image/png', size: 1000, width: null, height: null, url: pic() }] }
      useStore.getState().updateMessage(withImage)
    }, 2000)
  }
  const older = () => { const first = useStore.getState().messages[active]?.[0]; if (first) void useStore.getState().loadMessages(active, first.id) }

  if (!ready || !me) return <div className="p-6 text-text-2">Loading…</div>
  const dm = useStore.getState().dms[active]
  const btn = 'w-full rounded-md bg-bg-3 px-3 py-2 text-left text-sm hover:bg-bg-4'
  return (
    <div className="h-full flex phone:flex-col bg-bg-2 text-text-0" data-chat-sim>
      <aside className="w-60 phone:w-full shrink-0 border-r phone:border-r-0 phone:border-b border-line bg-bg-1 p-3 space-y-2 phone:space-y-0 phone:flex phone:flex-wrap phone:gap-1.5 phone:p-2 [&_button]:phone:w-auto [&_button]:phone:py-1 [&_button]:phone:text-xs">
        <div className="text-xs font-bold uppercase text-text-2 phone:hidden">Chat simulator</div>
        {(['sim-dm-a', 'sim-dm-b'] as const).map((id) => (
          <button key={id} type="button" className={`${btn} ${active === id ? 'ring-1 ring-accent' : ''}`} onClick={() => setActive(id)} data-sim-dm={id}>{friend(id)?.display_name}</button>
        ))}
        <button type="button" className={btn} onClick={() => incoming(1)} data-sim-incoming="1">Incoming message</button>
        <button type="button" className={btn} onClick={() => incoming(5)} data-sim-incoming="5">Incoming ×5</button>
        <button type="button" className={btn} onClick={delayedImage} data-sim-image>Image (loads after 2s)</button>
        <button type="button" className={btn} onClick={older} data-sim-older>Load older page</button>
        <div className="text-[11px] text-text-2 phone:w-full" data-sim-stats>{stats}</div>
        <Link to="/channels/@me" className="block text-xs text-sky-400 hover:underline phone:hidden">Back to the app</Link>
      </aside>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="h-12 shrink-0 border-b border-line flex items-center gap-2 px-4 font-semibold"><Avatar user={dm.recipients[0]} size={24} />{dm.recipients[0].display_name}</header>
        <ChatPane key="sim" channel={dm} />
      </main>
    </div>
  )
}
