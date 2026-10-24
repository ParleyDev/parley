import { BarChart3, Camera, Eye, EyeOff, FileText, FolderOpen, ImagePlay, Images, Mic, PlusCircle, SendHorizontal, Smile, Sticker, Trash2, Upload, X } from 'lucide-react'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { recordEmoji } from '../lib/recentEmoji'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { myChannelPerms, useStore } from '../store'
import { sendTyping } from '../lib/ws'
import { convertEmoticons, getPrefs } from '../lib/prefs'
import type { Attachment, Channel, DmChannel, Draft, Message } from '../lib/types'
import type { ApiError } from '../lib/api'
import { has, isTimedOut, P } from '../lib/perms'
import { formatBytes, isImage, MAX_PER_MESSAGE, uploadFile, uploadVoice, type UploadHandle } from '../lib/upload'
import { VoiceRecorder } from '../lib/voiceRecorder'
import { shortcutFormat, toggleWrap } from '../lib/editor'
import FormatToolbar from './FormatToolbar'
import ExpressionPicker, { type PickerTab } from './ExpressionPicker'
import ShortcodeSuggest, { shortcodeAt, useShortcodeSuggestions, type Suggestion } from './ShortcodeSuggest'
import MentionSuggest, { applyMentions, mentionAt, useMentionItems, type MentionItem } from './MentionSuggest'
import { dmName, isGroup } from '../lib/dm'
import { useT } from '../lib/i18n'


interface Props { channel: Channel | DmChannel; reply: Message | null; onCancelReply: () => void; onSent: () => void }

interface Pending { key: number; file: File; preview: string | null; progress: number; done: Attachment | null; error: string | null; handle: UploadHandle | null }

let pendingSeq = 1

export default function Composer({ channel, reply, onCancelReply, onSent }: Props) {
  const t = useT()
  const sendMessage = useStore((s) => s.sendMessage)
  const failDelivery = useStore((s) => s.failDelivery)
  const pushToast = useStore((s) => s.pushToast)
  /** An undeliverable DM is kept in the list in red with a Ribbit notice instead of a toast. */
  const undeliverable = (e: unknown, draft: Draft): boolean => {
    if ((e as ApiError).code !== 'undeliverable') return false
    failDelivery(channel.id, draft); onCancelReply(); onSent()
    return true
  }
  const openModal = useStore((s) => s.openModal)
  const typing = useStore((s) => s.typing[channel.id])
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const myMember = useStore((s) => (channel.guild_id && s.user ? s.members[channel.guild_id]?.[s.user.id] : undefined))
  const [, bump] = useState(0)
  // Re-render the moment a timeout lapses so the box comes back without a reload.
  useEffect(() => {
    if (!myMember?.timeout_until) return
    const ms = new Date(myMember.timeout_until).getTime() - Date.now()
    if (ms <= 0) return
    const t = setTimeout(() => bump((n) => n + 1), ms + 50)
    return () => clearTimeout(t)
  }, [myMember?.timeout_until])
  const timedOut = isTimedOut(myMember)
  const rulesGuild = useStore((s) => (channel.guild_id ? s.guilds[channel.guild_id] : undefined))
  const rulesPending = !!rulesGuild?.rules_required && !!myMember && !myMember.rules_accepted_at
  const canSend = has(perms, P.SEND_MESSAGES) && !timedOut && !rulesPending
  const canAttach = canSend && (channel.guild_id === null || has(perms, P.ATTACH_FILES))
  const [value, setValue] = useState('')
  const [picker, setPicker] = useState<PickerTab | null>(null)
  // `:shortcode` autocomplete: tracks the query at the caret, the highlighted row, and whether it was dismissed.
  const [shortcode, setShortcode] = useState<{ start: number; query: string } | null>(null)
  const [suggestIdx, setSuggestIdx] = useState(0)
  const suggestions = useShortcodeSuggestions(getPrefs().emojiSuggestions ? shortcode?.query ?? null : null, channel.guild_id)
  // `@name` / `#channel` autocomplete. Picks are typed as plain text and swapped for wire tokens on send.
  const [mention, setMention] = useState<{ start: number; trigger: '@' | '#'; query: string } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [picked, setPicked] = useState<Record<string, MentionItem>>({})
  const mentionItems = useMentionItems(mention?.trigger ?? null, mention?.query ?? '', channel.id, channel.guild_id)
  const pickMention = (it: MentionItem) => {
    const el = ref.current
    const mn = mention
    if (!el || !mn) return
    const caret = el.selectionStart ?? value.length
    const text = (mn.trigger === '#' ? '#' : '@') + it.label
    const next = value.slice(0, mn.start) + text + ' ' + value.slice(caret)
    setValue(next); setMention(null); setPicked((p) => ({ ...p, [text]: it }))
    requestAnimationFrame(() => { el.focus(); const pos = mn.start + text.length + 1; el.setSelectionRange(pos, pos) })
  }
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  // Touch devices get a sheet of big targets that open the phone's own pickers (photos, camera, files).
  const [sheet, setSheet] = useState(false)
  // A narrow box (phones, larger text) folds the GIF and sticker buttons into the emoji button, whose picker has
  // those tabs, so the text keeps its room. Measured rather than a container query, which would trap the pickers'
  // fixed-position layers inside the box.
  const boxRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 480))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const lastTyping = useRef(0)
  const isDm = channel.guild_id === null
  const name = isDm ? (isGroup(channel as DmChannel) ? dmName(channel as DmChannel, users, notes) : `@${(channel as DmChannel).recipients[0]?.display_name ?? ''}`) : (channel as Channel).kind === 'voice' ? channel.name : `#${channel.name}`

  // Opening a channel focuses the box on devices with a mouse or trackpad only; on a phone that would pop the
  // keyboard over the chat. Choosing Reply is a deliberate "I want to type", so it focuses everywhere.
  useEffect(() => { if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) ref.current?.focus() }, [channel.id])
  useEffect(() => { if (reply) ref.current?.focus() }, [reply])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Empty: the one row the textarea has, however long the placeholder (it is cut off, never wrapped). With text,
    // grow with it (up to 300px).
    if (!value) { el.style.height = ''; return }
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 300) + 'px'
  }, [value])
  // Switching channels drops the draft attachments (and cancels in-flight uploads).
  useEffect(() => () => { setPending((ps) => { ps.forEach((p) => { p.handle?.abort(); if (p.preview) URL.revokeObjectURL(p.preview) }); return [] }) }, [channel.id])

  const addFiles = (files: FileList | File[]) => {
    if (!canAttach) { pushToast('You do not have permission to attach files here', 'error'); return }
    const list = Array.from(files)
    if (!list.length) return
    setPending((ps) => {
      const room = MAX_PER_MESSAGE - ps.length
      if (list.length > room) pushToast(`You can attach up to ${MAX_PER_MESSAGE} files per message`, 'error')
      const next = list.slice(0, Math.max(0, room)).map((file): Pending => {
        const key = pendingSeq++
        const preview = isImage(file.type) ? URL.createObjectURL(file) : null
        const p: Pending = { key, file, preview, progress: 0, done: null, error: null, handle: null }
        p.handle = uploadFile(channel.id, file, (f) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, progress: f } : x))))
        p.handle.promise
          .then((att) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, done: att, progress: 1 } : x))))
          .catch((e: Error) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, error: e.message } : x))))
        return p
      })
      return [...ps, ...next]
    })
    ref.current?.focus()
  }
  // Spoilers are a filename convention (SPOILER_…), so toggling re-uploads under the new name.
  const toggleSpoiler = (key: number) => setPending((ps) => ps.map((p) => {
    if (p.key !== key) return p
    p.handle?.abort()
    const spoiler = !p.file.name.startsWith('SPOILER_')
    const file = new File([p.file], spoiler ? `SPOILER_${p.file.name}` : p.file.name.replace(/^SPOILER_/, ''), { type: p.file.type })
    const next: Pending = { ...p, file, progress: 0, done: null, error: null, handle: null }
    next.handle = uploadFile(channel.id, file, (f) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, progress: f } : x))))
    next.handle.promise
      .then((att) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, done: att, progress: 1 } : x))))
      .catch((e: Error) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, error: e.message } : x))))
    return next
  }))
  const removePending = (key: number) => setPending((ps) => {
    const p = ps.find((x) => x.key === key)
    if (p) { p.handle?.abort(); if (p.preview) URL.revokeObjectURL(p.preview) }
    return ps.filter((x) => x.key !== key)
  })

  // Drag and drop anywhere on the page targets the open composer.
  useEffect(() => {
    if (!canAttach) return
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setDragging(true) }
    const onLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false) }
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const onDrop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; setDragging(false); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files) }
    window.addEventListener('dragenter', onEnter); window.addEventListener('dragleave', onLeave); window.addEventListener('dragover', onOver); window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAttach, channel.id])

  const uploading = pending.some((p) => !p.done && !p.error)
  const ready = pending.filter((p) => p.done)
  const canSubmit = (value.trim().length > 0 || ready.length > 0) && !uploading && !sending

  const submit = async () => {
    if (!canSubmit) return
    const content = applyMentions(getPrefs().emoticons ? convertEmoticons(value.trim()) : value.trim(), picked)
    const ids = ready.map((p) => p.done!.id)
    const snapshot = pending
    setValue(''); setPending([]); setPicked({}); setMention(null); onCancelReply(); setSending(true)
    try {
      await sendMessage(channel.id, content, reply?.id, ids)
      snapshot.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview) })
      onSent()
    } catch (e) {
      if (undeliverable(e, { content, reply_to: reply?.id ?? null, attachment_ids: ids, sticker_id: null })) { snapshot.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview) }); return }
      pushToast((e as Error).message, 'error'); setValue(content); setPending(snapshot)
    } finally { setSending(false) }
  }

  /** Replace the `:query` being typed with the chosen emoji (plus a space) and restore the caret. */
  const pickSuggestion = (sug: Suggestion) => {
    const el = ref.current
    const sc = shortcode
    if (!el || !sc) return
    const caret = el.selectionStart ?? value.length
    const next = value.slice(0, sc.start) + sug.token + ' ' + value.slice(caret)
    setValue(next); setShortcode(null); recordEmoji(sug.token)
    requestAnimationFrame(() => { el.focus(); const pos = sc.start + sug.token.length + 1; el.setSelectionRange(pos, pos) })
  }
  const updateShortcode = (text: string, caret: number) => {
    const mn = mentionAt(text, caret)
    setMention((cur) => (mn?.start !== cur?.start || mn?.query !== cur?.query || mn?.trigger !== cur?.trigger ? mn : cur))
    if (!mn || mn.start !== mention?.start) setMentionIdx(0)
    const sc = shortcodeAt(text, caret)
    setShortcode((cur) => (sc?.start !== cur?.start || sc?.query !== cur?.query ? sc : cur))
    if (!sc || sc.start !== shortcode?.start) setSuggestIdx(0)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : mentionItems.length - 1)) % mentionItems.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionItems[mentionIdx] ?? mentionItems[0]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
    }
    if (shortcode && suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSuggestIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSuggestion(suggestions[suggestIdx] ?? suggestions[0]); return }
      if (e.key === 'Escape') { e.preventDefault(); setShortcode(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return }
    if (e.key === 'Escape' && reply) onCancelReply()
    const f = shortcutFormat(e)
    if (f && ref.current) { e.preventDefault(); setValue(toggleWrap(ref.current, f)) }
  }
  const onChange = (v: string) => {
    const el = ref.current
    const caret = el?.selectionStart ?? v.length
    // Typing the closing colon of an exact shortcode (`:fire:`) swaps it for the emoji immediately.
    if (v[caret - 1] === ':' && shortcode) {
      const typed = v.slice(shortcode.start + 1, caret - 1)
      const exact = suggestions.find((s) => s.label === `:${typed}:`)
      if (exact && el) {
        const next = v.slice(0, shortcode.start) + exact.token + ' ' + v.slice(caret)
        setValue(next); setShortcode(null); recordEmoji(exact.token)
        requestAnimationFrame(() => { const pos = shortcode.start + exact.token.length + 1; el.setSelectionRange(pos, pos) })
        return
      }
    }
    setValue(v)
    updateShortcode(v, caret)
    const now = Date.now()
    if (v && now - lastTyping.current > 4000) { lastTyping.current = now; sendTyping(channel.id) }
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length) { e.preventDefault(); addFiles(files) }
  }

  const typers = Object.keys(typing ?? {}).map((id) => users[id]?.display_name ?? 'Someone')

  /** Insert text at the caret (emoji picks), keeping focus in the textarea. */
  const insert = (text: string) => {
    const el = ref.current
    if (!el) { setValue((v) => v + text); return }
    const start = el.selectionStart ?? value.length, end = el.selectionEnd ?? value.length
    const pad = start > 0 && !/\s$/.test(value.slice(0, start)) ? ' ' : ''
    const next = value.slice(0, start) + pad + text + ' ' + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => { el.focus(); const pos = start + pad.length + text.length + 1; el.setSelectionRange(pos, pos) })
  }
  const sendSticker = async (st: { id: string; name: string }) => {
    setSending(true)
    try { await sendMessage(channel.id, '', reply?.id, [], st.id); onCancelReply(); onSent() } catch (e) { if (!undeliverable(e, { content: '', reply_to: reply?.id ?? null, attachment_ids: [], sticker_id: st.id })) pushToast((e as Error).message, 'error') } finally { setSending(false) }
  }
  // Voice messages: hold state for the recorder bar that replaces the text box while recording.
  const recorder = useRef<VoiceRecorder | null>(null)
  const [rec, setRec] = useState<{ ms: number; levels: number[] } | null>(null)
  const [recBusy, setRecBusy] = useState(false)
  const startRecording = async () => {
    if (recorder.current || !canAttach) return
    const r = new VoiceRecorder()
    try {
      await r.start((levels, ms) => setRec({ ms, levels: levels.slice(-40) }))
      recorder.current = r; setRec({ ms: 0, levels: [] })
    } catch (e) { pushToast(`Microphone unavailable: ${(e as Error).message}`, 'error') }
  }
  const cancelRecording = () => { recorder.current?.cancel(); recorder.current = null; setRec(null) }
  const sendRecording = async () => {
    const r = recorder.current; if (!r) return
    recorder.current = null; setRecBusy(true)
    try {
      const out = await r.stop()
      if (out.durationMs < 300) throw new Error('Recording too short')
      const att = await uploadVoice(channel.id, out.blob, out.waveform, out.durationMs)
      await sendMessage(channel.id, '', reply?.id, [att.id])
      onCancelReply(); onSent()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setRecBusy(false); setRec(null) }
  }
  useEffect(() => () => { recorder.current?.cancel() }, [])
  // The "+" menu on the left of the box: everything that adds something other than text.
  const plus = useContextMenu()
  const plusItems: MenuEntry[] = [
    { label: 'Upload a File', icon: <Upload size={16} />, disabled: !canAttach, onClick: () => fileRef.current?.click() },
    { label: 'Create Poll', icon: <BarChart3 size={16} />, onClick: () => openModal({ kind: 'createPoll', channelId: channel.id }) },
    ...(typeof MediaRecorder !== 'undefined' ? [{ label: 'Record Voice Message', icon: <Mic size={16} />, disabled: !canAttach, onClick: () => { void startRecording() } }] : []),
  ]
  const sendGif = async (g: { url: string }) => {
    setSending(true)
    try { await sendMessage(channel.id, g.url, reply?.id); onCancelReply(); onSent() } catch (e) { if (!undeliverable(e, { content: g.url, reply_to: reply?.id ?? null, attachment_ids: [], sticker_id: null })) pushToast((e as Error).message, 'error') } finally { setSending(false) }
  }

  if (!canSend) {
    return (
      <div className="shrink-0 px-4 pb-2 pt-1 max-md:px-2 max-md:pb-2">
        {rulesPending
          ? <div className="rounded-xl bg-accent/10 border border-accent/40 px-4 py-3 text-[15px] text-text-1 flex items-center gap-3" data-rules-gate><span className="flex-1">Read and accept the server rules to start chatting in <b>{rulesGuild?.name}</b>.</span><button type="button" className="btn-primary py-1.5" onClick={() => openModal({ kind: 'rules', guildId: channel.guild_id! })} data-rules-open>View rules</button></div>
          : timedOut
          ? <div className="rounded-xl bg-danger/10 border border-danger/40 px-4 py-3 text-[15px] text-text-1" data-timed-out>You are timed out in this server until <b>{new Date(myMember!.timeout_until!).toLocaleString()}</b>. You can read, but not send messages, react or join voice.</div>
          : <div className="rounded-xl bg-bg-3/60 border border-line px-4 py-3 text-[15px] text-text-2">You do not have permission to send messages in this channel.</div>}
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="shrink-0 px-4 pb-2 pt-1 max-md:px-2 max-md:pb-2 relative">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/20 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-bg-1/90 px-10 py-8 text-center pop">
            <div className="text-xl font-bold">Upload to {name}</div>
            <div className="text-sm text-text-2 mt-1">Drop files to attach them to your message</div>
          </div>
        </div>
      )}
      <div className="absolute -top-5 left-5 right-5 h-5 text-xs text-text-1 flex items-center gap-1.5 pointer-events-none" data-typing-row>
        {typers.length > 0 && (
          <>
            <span className="flex gap-0.5"><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /><i className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" /></span>
            <span><b>{typers.slice(0, 3).join(', ')}</b> {typers.length > 3 ? 'and others are' : typers.length === 1 ? 'is' : 'are'} typing…</span>
          </>
        )}
      </div>
      <FormatToolbar textarea={ref} onChange={setValue} className="absolute -top-8 left-4 max-md:left-2 z-20" />
      {mention && mentionItems.length > 0 && (
        <MentionSuggest items={mentionItems} active={mentionIdx} trigger={mention.trigger} query={mention.query} onPick={pickMention} onHover={setMentionIdx} className="bottom-full left-4 right-4 max-md:left-2 max-md:right-2 mb-2" />
      )}
      {shortcode && suggestions.length > 0 && !mention && (
        <ShortcodeSuggest query={shortcode.query} items={suggestions} active={suggestIdx} onPick={pickSuggestion} onHover={setSuggestIdx} className="bottom-full left-4 right-4 max-md:left-2 max-md:right-2 mb-2" />
      )}
      <div ref={boxRef} className="rounded-xl bg-bg-3 border border-line focus-within:border-accent/50 transition" data-composer-box data-composer-narrow={narrow ? '1' : undefined}>
        {reply && (
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-text-1 border-b border-line bg-bg-4/40 rounded-t-xl">
            <span>Replying to <b className="text-text-0">{reply.author.display_name}</b></span>
            <button onClick={onCancelReply} className="text-text-2 hover:text-text-0"><X size={14} /></button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex gap-3 overflow-x-auto px-3 pt-3 pb-1 border-b border-line">
            {pending.map((p) => (
              <div key={p.key} className={`relative w-40 shrink-0 rounded-lg border bg-bg-2 p-2 ${p.error ? 'border-danger' : 'border-line'}`} data-pending>
                <button onClick={() => removePending(p.key)} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-bg-1 border border-line text-text-2 hover:text-danger flex items-center justify-center" title="Remove"><X size={12} /></button>
                <button onClick={() => toggleSpoiler(p.key)} className={`absolute left-1 top-1 z-10 h-6 w-6 rounded-md flex items-center justify-center ${p.file.name.startsWith('SPOILER_') ? 'bg-accent text-white' : 'bg-bg-1/80 text-text-2 hover:text-text-0'}`} title={p.file.name.startsWith('SPOILER_') ? 'Unmark as spoiler' : 'Mark as spoiler'} data-spoiler-toggle>{p.file.name.startsWith('SPOILER_') ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <div className="h-24 flex items-center justify-center overflow-hidden rounded bg-bg-0/40">
                  {p.preview ? <img src={p.preview} alt="" className={`h-full w-full object-contain ${p.file.name.startsWith('SPOILER_') ? 'blur-md brightness-50' : ''}`} /> : <FileText size={36} className="text-text-2" />}
                </div>
                <div className="mt-1.5 text-xs truncate" title={p.file.name}>{p.file.name.replace(/^SPOILER_/, '')}</div>
                <div className="text-[10px] text-text-2">{p.error ? <span className="text-danger">{p.error}</span> : p.done ? formatBytes(p.file.size) : `Uploading… ${Math.round(p.progress * 100)}%`}</div>
                {!p.done && !p.error && <div className="mt-1 h-1 rounded bg-bg-4 overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>}
              </div>
            ))}
          </div>
        )}
        {(rec || recBusy) ? (
          <div className="flex items-center gap-3 px-3 py-2" data-voice-recording>
            <button className="text-text-2 hover:text-danger" title="Discard recording" onClick={cancelRecording} disabled={recBusy} data-voice-cancel><Trash2 size={20} /></button>
            <span className="relative flex h-3 w-3 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-danger" /></span>
            <span className="text-sm tabular-nums text-text-0 w-10" data-voice-timer>{Math.floor((rec?.ms ?? 0) / 60000)}:{String(Math.floor(((rec?.ms ?? 0) % 60000) / 1000)).padStart(2, '0')}</span>
            <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" data-voice-levels>
              {Array.from({ length: 40 }, (_, i) => { const v = rec?.levels[rec.levels.length - 40 + i] ?? 0; return <span key={i} className="w-[3px] shrink-0 rounded-full bg-accent transition-[height] duration-100" style={{ height: `${Math.max(10, v * 100)}%`, opacity: 0.4 + v * 0.6 }} /> })}
            </div>
            <span className="text-xs text-text-2 max-md:hidden">{recBusy ? 'Sending…' : 'Recording…'}</span>
            <button className="h-9 w-9 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-50" title="Send voice message" onClick={sendRecording} disabled={recBusy} data-voice-send><SendHorizontal size={18} /></button>
          </div>
        ) : (
        <div className="flex items-end gap-2 px-3 py-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} data-file-input="files" />
          <input ref={mediaRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} data-file-input="media" />
          <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} data-file-input="camera" />
          <button className="pb-1 text-text-2 hover:text-text-0" title="Attach, poll or voice message" onClick={(e) => {
            if (window.matchMedia('(pointer: coarse)').matches) { setSheet(true); return }
            const r = (e.currentTarget.closest('[data-composer-box]') ?? e.currentTarget).getBoundingClientRect(); plus.open({ clientX: r.left, clientY: r.top - 8 }, plusItems, { above: true })
          }} aria-haspopup="menu" data-composer-plus><PlusCircle size={22} /></button>
          <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} onPaste={onPaste} placeholder={t('Message {name}', { name })}
            onClick={(e) => updateShortcode(value, e.currentTarget.selectionStart ?? value.length)} onBlur={() => setTimeout(() => { setShortcode(null); setMention(null) }, 150)}
            className="composer-input flex-1 min-w-0 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-text-2 max-h-[300px]" maxLength={2000} />
                    <div className="relative pb-1 flex shrink-0 items-center gap-2.5">
            {!narrow && <button className={`${picker === 'gif' ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} onClick={() => setPicker((p) => (p === 'gif' ? null : 'gif'))} title="GIF" data-gif-button><ImagePlay size={22} /></button>}
            {!narrow && <button className={`${picker === 'sticker' ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} onClick={() => setPicker((p) => (p === 'sticker' ? null : 'sticker'))} title="Sticker" data-sticker-button><Sticker size={22} /></button>}
            <button className={`${picker === 'emoji' ? 'text-warn' : 'text-text-2 hover:text-warn'}`} onClick={() => setPicker((p) => (p === 'emoji' ? null : 'emoji'))} title="Emoji" data-emoji-button><Smile size={22} /></button>
            {picker && (
              <ExpressionPicker initial={picker} guildId={channel.guild_id} className="bottom-full right-0 mb-3" onClose={() => setPicker(null)}
                onEmoji={(t) => { insert(t); recordEmoji(t) }} onSticker={sendSticker} onGif={sendGif} />
            )}
          </div>
          <button onClick={submit} disabled={!canSubmit} className="text-accent disabled:text-text-2 pb-1 hover:text-accent-hover" title="Send"><SendHorizontal size={22} /></button>
        </div>
        )}
      </div>
      {plus.menu && <ContextMenu {...plus.menu} onClose={plus.close} label="Add to message" />}
      {sheet && (
        <AttachSheet onClose={() => setSheet(false)} canAttach={canAttach} canRecord={typeof MediaRecorder !== 'undefined'}
          onPick={(what) => {
            setSheet(false)
            if (what === 'media') mediaRef.current?.click()
            else if (what === 'camera') cameraRef.current?.click()
            else if (what === 'files') fileRef.current?.click()
            else if (what === 'poll') openModal({ kind: 'createPoll', channelId: channel.id })
            else void startRecording()
          }} />
      )}
    </div>
  )
}

type AttachKind = 'media' | 'camera' | 'files' | 'poll' | 'voice'

/** Touch devices: what "+" adds, as a bottom sheet of big targets. Photos, Camera and Files open the phone's own
 *  pickers (on iOS the Photos one is the system photo library), so there is no separate "upload" step. */
function AttachSheet({ onPick, onClose, canAttach, canRecord }: { onPick: (k: AttachKind) => void; onClose: () => void; canAttach: boolean; canRecord: boolean }) {
  useEffect(() => { const k = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const items: { id: AttachKind; label: string; icon: React.ReactNode; tint: string; show: boolean }[] = [
    { id: 'media', label: 'Photos & videos', icon: <Images size={24} />, tint: 'bg-accent text-white', show: canAttach },
    { id: 'camera', label: 'Camera', icon: <Camera size={24} />, tint: 'bg-sky-500 text-white', show: canAttach },
    { id: 'files', label: 'Files', icon: <FolderOpen size={24} />, tint: 'bg-bg-4 text-text-0', show: canAttach },
    { id: 'poll', label: 'Poll', icon: <BarChart3 size={24} />, tint: 'bg-success text-black', show: true },
    { id: 'voice', label: 'Voice message', icon: <Mic size={24} />, tint: 'bg-danger text-white', show: canAttach && canRecord },
  ]
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-attach-sheet>
      <div className="sheet-up w-full rounded-t-2xl border-t border-line bg-bg-1 px-4 pt-3" style={{ paddingBottom: 'calc(1rem + var(--sab))', paddingLeft: 'max(1rem, var(--sal))', paddingRight: 'max(1rem, var(--sar))' }} role="dialog" aria-label="Add to message">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-bg-4" />
        <div className="grid grid-cols-5 gap-2 max-[360px]:grid-cols-3">
          {items.filter((i) => i.show).map((i) => (
            <button key={i.id} type="button" onClick={() => onPick(i.id)} className="flex flex-col items-center gap-1.5 rounded-xl py-2 text-xs text-text-1 hover:bg-bg-3" data-attach={i.id}>
              <span className={`h-12 w-12 rounded-full flex items-center justify-center ${i.tint}`}>{i.icon}</span>
              <span className="text-center leading-tight">{i.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
