import { AudioLines, Blocks, Lock, Mic, Shield, SlidersHorizontal, Tag, Timer, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { myChannelPerms, useStore } from '../../store'
import { SLOWMODE } from '../../lib/slowmode'
import type { Channel } from '../../lib/types'
import { has, P } from '../../lib/perms'
import SettingsShell from './SettingsShell'
import ChannelPermissionsTab from './settings/ChannelPermissionsTab'
import ForumTagsTab from './settings/ForumTagsTab'
import FollowersTab from './settings/FollowersTab'
import StageModeratorsTab from './settings/StageModeratorsTab'
import { DEFAULT_BITRATE, MAX_BITRATE, MIN_BITRATE, type AudioMode } from '../../lib/audioProfile'

type Tab = 'overview' | 'permissions' | 'tags' | 'integrations' | 'stageMods'

export default function ChannelSettingsModal({ onClose, channelId, tab: requested }: { onClose: () => void; channelId: string; tab?: Tab }) {
  const initial: Tab = requested ?? 'overview'
  const channel = useStore((s) => s.channels[channelId])
  const perms = useStore((s) => myChannelPerms(s, channelId))
  const openModal = useStore((s) => s.openModal)
  const removeChannel = useStore((s) => s.removeChannel)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const canEdit = has(perms, P.MANAGE_CHANNELS)
  const canPerms = has(perms, P.MANAGE_ROLES)
  const [tab, setTab] = useState<Tab>(initial === 'overview' && !canEdit && canPerms ? 'permissions' : initial)
  if (!channel) return null
  const prefix = channel.kind === 'text' ? '#' : ''

  const del = () => openModal({
    kind: 'confirm', title: 'Delete Channel', body: `Are you sure you want to delete ${prefix}${channel.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Channel',
    action: async () => {
      try { await api.delete(`/channels/${channelId}`); removeChannel(channelId); onClose(); navigate(`/channels/${channel.guild_id}`) } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })

  const items: { id: Tab; label: string; icon: React.ReactNode }[] = []
  if (canEdit) items.push({ id: 'overview', label: 'Overview', icon: <SlidersHorizontal size={16} /> })
  if (canEdit && channel.kind === 'forum') items.push({ id: 'tags', label: 'Tags', icon: <Tag size={16} /> })
  if (canEdit && channel.kind === 'text') items.push({ id: 'integrations', label: 'Integrations', icon: <Blocks size={16} /> })
  if (canPerms) items.push({ id: 'permissions', label: 'Permissions', icon: <Lock size={16} /> })
  if (canPerms && channel.kind === 'stage') items.push({ id: 'stageMods', label: 'Stage Moderators', icon: <Shield size={16} /> })

  return (
    <SettingsShell<Tab>
      tab={tab} onTab={setTab} onClose={onClose} wide={tab === 'permissions'} title="Channel Settings" startOnMenu={!requested}
      sections={[{ title: `${prefix}${channel.name}`, items }]}
      footer={canEdit ? <button onClick={del} className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-danger hover:bg-bg-3 whitespace-nowrap" title="Delete Channel"><span>Delete Channel</span><Trash2 size={16} /></button> : undefined}
    >
      {tab === 'overview' && canEdit && <Overview channel={channel} />}
      {tab === 'tags' && canEdit && <ForumTagsTab channelId={channelId} />}
      {tab === 'integrations' && canEdit && <FollowersTab channelId={channelId} />}
      {tab === 'permissions' && canPerms && <ChannelPermissionsTab channelId={channelId} />}
      {tab === 'stageMods' && canPerms && <StageModeratorsTab channelId={channelId} />}
    </SettingsShell>
  )
}

function Overview({ channel }: { channel: Channel }) {
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic)
  const [forumLayout, setForumLayout] = useState<'gallery' | 'list'>(channel.forum_layout === 'list' ? 'list' : 'gallery')
  const [forumSort, setForumSort] = useState<'activity' | 'created'>(channel.forum_sort === 'created' ? 'created' : 'activity')
  const [requireTag, setRequireTag] = useState(!!channel.forum_require_tag)
  const [defaultReaction, setDefaultReaction] = useState(channel.forum_default_reaction ?? '')
  const forumDirty = channel.kind === 'forum' && (forumLayout !== (channel.forum_layout === 'list' ? 'list' : 'gallery') || forumSort !== (channel.forum_sort === 'created' ? 'created' : 'activity') || requireTag !== !!channel.forum_require_tag || defaultReaction !== (channel.forum_default_reaction ?? ''))
  const [nsfw, setNsfw] = useState(!!channel.nsfw)
  const [spoiler, setSpoiler] = useState(!!channel.spoiler)
  const [news, setNews] = useState(!!channel.news)
  const [media, setMedia] = useState(!!channel.media)
  const [slowmode, setSlowmode] = useState(channel.rate_limit_per_user ?? 0)
  const [userLimit, setUserLimit] = useState(channel.user_limit ?? 0)
  const [videoQuality, setVideoQuality] = useState<'auto' | 'full'>(channel.video_quality === 'full' ? 'full' : 'auto')
  const hasSlowmode = channel.guild_id !== null && (channel.kind === 'text' || channel.kind === 'thread')
  const [audioMode, setAudioMode] = useState<AudioMode>(channel.audio_mode === 'music' ? 'music' : 'voice')
  const [bitrate, setBitrate] = useState(channel.audio_bitrate ?? 0)
  const [lowLatency, setLowLatency] = useState(!!channel.audio_low_latency)
  const [e2ee, setE2ee] = useState(!!channel.e2ee)
  const [busy, setBusy] = useState(false)
  const isAudio = channel.kind === 'voice' || channel.kind === 'stage' || channel.kind === 'studio'
  const audioDirty = isAudio && (audioMode !== (channel.audio_mode === 'music' ? 'music' : 'voice') || bitrate !== (channel.audio_bitrate ?? 0) || lowLatency !== !!channel.audio_low_latency || e2ee !== !!channel.e2ee)
  const dirty = name !== channel.name || topic !== channel.topic || nsfw !== !!channel.nsfw || spoiler !== !!channel.spoiler || news !== !!channel.news || media !== !!channel.media || slowmode !== (channel.rate_limit_per_user ?? 0) || userLimit !== (channel.user_limit ?? 0) || (channel.kind === 'voice' && videoQuality !== (channel.video_quality === 'full' ? 'full' : 'auto')) || audioDirty || forumDirty
  const reset = () => { setName(channel.name); setTopic(channel.topic); setNsfw(!!channel.nsfw); setSpoiler(!!channel.spoiler); setNews(!!channel.news); setMedia(!!channel.media); setSlowmode(channel.rate_limit_per_user ?? 0); setUserLimit(channel.user_limit ?? 0); setVideoQuality(channel.video_quality === 'full' ? 'full' : 'auto'); setAudioMode(channel.audio_mode === 'music' ? 'music' : 'voice'); setBitrate(channel.audio_bitrate ?? 0); setLowLatency(!!channel.audio_low_latency); setE2ee(!!channel.e2ee); setForumLayout(channel.forum_layout === 'list' ? 'list' : 'gallery'); setForumSort(channel.forum_sort === 'created' ? 'created' : 'activity'); setRequireTag(!!channel.forum_require_tag); setDefaultReaction(channel.forum_default_reaction ?? '') }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const c = await api.patch<Channel>(`/channels/${channel.id}`, { name, topic, nsfw, ...(channel.kind === 'text' || channel.kind === 'forum' ? { spoiler } : {}), ...(channel.kind === 'text' ? { news } : {}), ...(channel.kind === 'forum' ? { media } : {}), ...(hasSlowmode ? { rate_limit_per_user: slowmode } : {}), ...(channel.kind === 'voice' ? { user_limit: userLimit, video_quality: videoQuality } : {}), ...(channel.kind === 'forum' ? { forum_layout: forumLayout, forum_sort: forumSort, forum_require_tag: requireTag, forum_default_reaction: defaultReaction } : {}), ...(isAudio ? { audio_mode: audioMode, audio_bitrate: bitrate, audio_low_latency: lowLatency, e2ee } : {}) }); upsertChannel(c); pushToast('Channel updated') } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-xl font-bold">Overview</h1>
      <div><label className="label">Channel name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
      {channel.kind === 'forum' && (
        <div className="space-y-3" data-forum-settings>
          <div><label className="label">Post guidelines</label><textarea className="input resize-none" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="What should people post here?" data-forum-guidelines /></div>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Default layout <select className="input ml-1 w-auto py-1" value={forumLayout} onChange={(e) => setForumLayout(e.target.value as 'gallery' | 'list')} data-forum-layout-setting><option value="gallery">Gallery</option><option value="list">List</option></select></label>
            <label className="text-sm">Default sort <select className="input ml-1 w-auto py-1" value={forumSort} onChange={(e) => setForumSort(e.target.value as 'activity' | 'created')} data-forum-sort-setting><option value="activity">Latest activity</option><option value="created">Newest posts</option></select></label>
            <label className="text-sm">Default reaction <input className="input ml-1 inline-block w-14 py-1 text-center" value={defaultReaction} onChange={(e) => setDefaultReaction(e.target.value)} maxLength={16} placeholder="👍" data-forum-reaction-setting /></label>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-accent" checked={requireTag} onChange={(e) => setRequireTag(e.target.checked)} data-forum-require-tag /> Require a tag on new posts</label>
        </div>
      )}
      {channel.kind === 'text' && <div><label className="label">Channel topic</label><textarea className="input resize-none" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="Let everyone know how to use this channel!" /></div>}
      {hasSlowmode && (
        <div data-channel-slowmode>
          <label className="label" htmlFor="slowmode">Slowmode</label>
          <select id="slowmode" className="input" value={slowmode} onChange={(e) => setSlowmode(Number(e.target.value))}>
            {SLOWMODE.map((o) => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-text-2">Members can send one message per this interval. Members who can manage messages or this channel are exempt.</p>
        </div>
      )}
      {(channel.kind === 'text' || channel.kind === 'forum') && (
        <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer" data-channel-nsfw={nsfw ? '1' : '0'}>
          <span><span className="block text-[15px]">Age-Restricted Channel</span><span className="block text-xs text-text-2">Members see a warning before opening it, and those who blur sensitive media get pictures and videos here blurred until clicked.</span></span>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
        </label>
      )}
      {channel.kind === 'text' && (
        <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer">
          <span><span className="block text-[15px]">Announcement Channel</span><span className="block text-xs text-text-2">Other servers can follow this channel, and posts you publish show up in their channels too.</span></span>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={news} onChange={(e) => setNews(e.target.checked)} data-channel-news />
        </label>
      )}
      {channel.kind === 'forum' && (
        <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer">
          <span><span className="block text-[15px]">Media Channel</span><span className="block text-xs text-text-2">Every post leads with an image or video, and posts show as a picture gallery.</span></span>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={media} onChange={(e) => setMedia(e.target.checked)} data-channel-media />
        </label>
      )}
      {(channel.kind === 'text' || channel.kind === 'forum') && (
        <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer" data-channel-spoiler={spoiler ? '1' : '0'}>
          <span><span className="block text-[15px]">Spoiler Channel</span><span className="block text-xs text-text-2">Members see a spoiler warning (with the topic) before opening it, and pictures and videos here stay hidden until clicked.</span></span>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} data-channel-spoiler-toggle />
        </label>
      )}
      {channel.kind === 'voice' && (
        <div data-channel-user-limit>
          <label className="label" htmlFor="user-limit">User limit</label>
          <div className="flex items-center gap-3">
            <input id="user-limit" type="range" min={0} max={99} value={userLimit} onChange={(e) => setUserLimit(Number(e.target.value))} className="flex-1 accent-accent" />
            <span className="w-24 text-right text-sm tabular-nums">{userLimit ? `${userLimit} user${userLimit === 1 ? '' : 's'}` : 'No limit'}</span>
          </div>
          <p className="mt-1 text-xs text-text-2">How many people can be in the channel at once. Members who can move members can still join a full channel.</p>
        </div>
      )}
      {channel.kind === 'voice' && (
        <div data-channel-video-quality>
          <label className="label" htmlFor="video-quality">Video quality</label>
          <select id="video-quality" className="input w-auto" value={videoQuality} onChange={(e) => setVideoQuality(e.target.value as 'auto' | 'full')} data-video-quality>
            <option value="auto">Auto (720p)</option>
            <option value="full">Full (1080p)</option>
          </select>
          <p className="mt-1 text-xs text-text-2">Camera resolution for everyone in this channel. Full uses more bandwidth.</p>
        </div>
      )}
      {isAudio && <AudioSection mode={audioMode} setMode={setAudioMode} bitrate={bitrate} setBitrate={setBitrate} lowLatency={lowLatency} setLowLatency={setLowLatency} />}
      {isAudio && (
        <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer" data-channel-e2ee={e2ee ? '1' : '0'}>
          <span><span className="flex items-center gap-1.5 text-[15px]"><Lock size={14} className="text-success" /> End-to-end encryption</span><span className="block text-xs text-text-2">Voice, video and screen shares are encrypted on each device with keys the server never sees. People compare a safety code in the call to check nobody is listening in. Members on an app or browser that can't encrypt can't join, and anyone in the call reconnects when you change this.</span></span>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={e2ee} onChange={(ev) => setE2ee(ev.target.checked)} />
        </label>
      )}
      {dirty && (
        <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
          <span className="text-sm flex-1">Careful — you have unsaved changes!</span>
          <button type="button" className="btn-ghost" onClick={reset}>Reset</button>
          <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !name.trim()}>Save Changes</button>
        </div>
      )}
    </form>
  )
}

/** Voice / stage / studio audio profile: speech vs high fidelity, Opus bitrate, ultra-low latency. */
function AudioSection({ mode, setMode, bitrate, setBitrate, lowLatency, setLowLatency }: {
  mode: AudioMode; setMode: (m: AudioMode) => void; bitrate: number; setBitrate: (b: number) => void; lowLatency: boolean; setLowLatency: (v: boolean) => void
}) {
  const effective = bitrate || DEFAULT_BITRATE[mode]
  const card = (m: AudioMode, icon: React.ReactNode, title: string, body: string) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m} data-audio-mode={m}
      className={`flex-1 min-w-[220px] text-left rounded-lg border px-3 py-2.5 ${mode === m ? 'border-accent bg-accent/10' : 'border-line bg-bg-1 hover:border-text-2'}`}>
      <span className="flex items-center gap-2 text-[15px] font-semibold">{icon}{title}</span>
      <span className="block mt-1 text-xs text-text-2">{body}</span>
    </button>
  )
  return (
    <section className="space-y-4" data-audio-settings>
      <h2 className="text-base font-bold">Audio</h2>
      <div className="flex flex-wrap gap-2">
        {card('voice', <Mic size={16} />, 'Voice', 'Clear speech. Uses each member\'s echo cancellation, noise suppression and auto gain; mono.')}
        {card('music', <AudioLines size={16} />, 'High fidelity', 'Music and instruments: 48 kHz stereo with all voice processing off. Members should wear headphones (no echo cancellation).')}
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0">Bitrate</label>
          <span className="text-sm font-semibold tabular-nums" data-audio-bitrate-value>{effective} kbps{bitrate ? '' : ' (default)'}</span>
        </div>
        <input type="range" min={MIN_BITRATE} max={MAX_BITRATE} step={1} value={effective} onChange={(e) => setBitrate(Number(e.target.value))} className="w-full accent-accent" data-audio-bitrate />
        <div className="flex items-center justify-between text-xs text-text-2">
          <span>{MIN_BITRATE} kbps</span>
          {bitrate ? <button type="button" className="hover:underline" onClick={() => setBitrate(0)} data-audio-bitrate-default>Use default ({DEFAULT_BITRATE[mode]} kbps)</button> : <span>Opus, up to {MAX_BITRATE} kbps</span>}
          <span>{MAX_BITRATE} kbps</span>
        </div>
        <p className="mt-1 text-xs text-text-2">Each member uploads this much per listener in peer-to-peer calls (once to the voice server when one is configured). 64 kbps is plenty for speech; 192-320 kbps is transparent for music.</p>
      </div>
      <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2.5 cursor-pointer" data-audio-low-latency={lowLatency ? '1' : '0'}>
        <span>
          <span className="flex items-center gap-2 text-[15px]"><Timer size={16} /> Ultra-low latency</span>
          <span className="block text-xs text-text-2">10 ms audio frames (half the usual) and the smallest jitter buffer the network allows: around 20-60 ms less delay, for playing together. Best on wired or strong connections; packet loss is more audible.</span>
        </span>
        <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={lowLatency} onChange={(e) => setLowLatency(e.target.checked)} />
      </label>
    </section>
  )
}
