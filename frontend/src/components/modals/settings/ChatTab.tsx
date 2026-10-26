import { setPrefs, usePrefs } from '../../../lib/prefs'
import { Toggle } from '../SettingsShell'

/** Settings → Chat: what shows inline, emoji conversion, reactions, spoilers, suggestions, media size. */
export default function ChatTab() {
  const p = usePrefs()
  const Choice = <T extends string>({ value, options, onPick, attr }: { value: T; options: [T, string][]; onPick: (v: T) => void; attr: string }) => (
    <div className="flex flex-wrap gap-2">{options.map(([v, label]) => <button key={v} type="button" onClick={() => onPick(v)} className={`rounded-md border px-3 py-1.5 text-sm ${value === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} {...{ [attr]: v }}>{label}</button>)}</div>
  )
  return (
    <div className="space-y-6" data-chat-tab>
      <h2 className="text-xl font-bold">Chat</h2>

      <section className="space-y-3">
        <h3 className="label">Display images, videos and links</h3>
        <Toggle label="When uploaded directly" checked={p.inlineAttachments} onChange={(v) => setPrefs({ inlineAttachments: v })} />
        <Toggle label="When posted as links" checked={p.linkMedia} onChange={(v) => setPrefs({ linkMedia: v })} />
        <Toggle label="Website previews (embeds)" checked={p.embeds} onChange={(v) => setPrefs({ embeds: v })} />
        <div>
          <label className="label">Inline media size</label>
          <Choice value={p.mediaSize} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onPick={(v) => setPrefs({ mediaSize: v })} attr="data-media-size" />
        </div>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3">
        <h3 className="label">Text box</h3>
        <Toggle label="Automatically convert emoticons" checked={p.emoticons} onChange={(v) => setPrefs({ emoticons: v })} />
        <Toggle label="Play /tts messages aloud" checked={p.ttsPlayback} onChange={(v) => setPrefs({ ttsPlayback: v })} />
        <Toggle label="Double-tap a message to react (touch screens)" checked={p.doubleTapReact} onChange={(v) => setPrefs({ doubleTapReact: v })} />
        {p.doubleTapReact && <label className="flex items-center justify-between gap-4 text-[15px]">Double-tap reaction<input className="input w-16 text-center text-lg" value={p.quickReaction} maxLength={16} onChange={(e) => e.target.value.trim() && setPrefs({ quickReaction: e.target.value.trim() })} data-quick-reaction /></label>}
        <p className="text-xs text-text-2">:-) becomes 🙂, &lt;3 becomes ❤️, and so on, when you send.</p>
        <Toggle label="Emoji suggestions" checked={p.emojiSuggestions} onChange={(v) => setPrefs({ emojiSuggestions: v })} />
        <p className="text-xs text-text-2">Suggest emoji while you type a :shortcode.</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3">
        <Toggle label="Show emoji reactions on messages" checked={p.showReactions} onChange={(v) => setPrefs({ showReactions: v })} />
        <div>
          <label className="label">Show spoiler content</label>
          <Choice value={p.spoilers} options={[['click', 'On click'], ['moderate', 'On servers I moderate'], ['always', 'Always']]} onPick={(v) => setPrefs({ spoilers: v })} attr="data-spoilers" />
        </div>
      </section>
    </div>
  )
}
