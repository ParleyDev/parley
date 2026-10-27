import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { DmPrivacy, FriendRequestSource, PrivateUser } from '../../../lib/types'
import { Toggle } from '../SettingsShell'

/** Settings → Content & Social: who can DM you, message requests, friend request permissions, group adds. */
export default function ContentSocialTab() {
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const pushToast = useStore((s) => s.pushToast)
  if (!user) return null
  const save = async (patch: Partial<Pick<PrivateUser, 'dm_privacy' | 'message_requests' | 'friend_request_from' | 'group_dm_privacy' | 'guild_dms_default' | 'sensitive_media' | 'spam_filter' | 'searchable'>>) => {
    try { const u = await api.patch<PrivateUser>('/users/@me/privacy', patch); if (token) setAuth(token, u) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const dm = user.dm_privacy ?? 'friends_and_servers'
  const from = user.friend_request_from ?? ['everyone']
  const toggleFrom = (k: FriendRequestSource) => {
    // "Everyone" implies the other two: ticking it ticks all, unticking it leaves the narrower two on.
    const next = k === 'everyone'
      ? (from.includes('everyone') ? ['friends_of_friends', 'server_members'] : ['everyone', 'friends_of_friends', 'server_members'])
      : from.includes(k) ? from.filter((x) => x !== k) : [...from, k]
    void save({ friend_request_from: next as FriendRequestSource[] })
  }
  const Radio = ({ value, label, hint }: { value: DmPrivacy; label: string; hint: string }) => (
    <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${dm === value ? 'border-accent bg-accent/10' : 'border-line bg-bg-1 hover:border-text-2'}`} data-dm-privacy={value} data-on={dm === value ? '1' : '0'}>
      <input type="radio" name="dm_privacy" className="mt-1 accent-accent" checked={dm === value} onChange={() => save({ dm_privacy: value })} />
      <span><span className="block text-[15px]">{label}</span><span className="block text-xs text-text-2">{hint}</span></span>
    </label>
  )
  const Check = ({ value, label, hint }: { value: FriendRequestSource; label: string; hint: string }) => (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer" data-friend-from={value} data-on={from.includes(value) ? '1' : '0'}>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={from.includes(value)} onChange={() => toggleFrom(value)} />
      <span><span className="block text-[15px]">{label}</span><span className="block text-xs text-text-2">{hint}</span></span>
    </label>
  )
  return (
    <div className="space-y-6" data-social-tab>
      <div className="flex items-center gap-3"><h2 className="text-xl font-bold">Content & Social</h2><button type="button" className="ml-auto btn-ghost bg-bg-3 py-1 text-sm" onClick={() => useStore.getState().openModal({ kind: 'safetyCenter' })} data-open-safety-center>Safety Center</button></div>

      <section className="space-y-2">
        <h3 className="label">Sensitive media</h3>
        <p className="text-xs text-text-2">Show media, blur only what looks explicit (Filter: checked on this device, nothing is uploaded), blur everything until clicked, or hide it all. Filter covers uploaded pictures and videos; link previews follow Show.</p>
        {([['friend_dms', 'Direct messages from friends'], ['non_friend_dms', 'Direct messages from people who are not your friends'], ['servers', 'Server channels'], ['restricted', 'Age-restricted channels']] as const).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-bg-1 px-3 py-2" data-sensitive={k} data-on={user.sensitive_media?.[k] ?? 'show'}>
            <span className="text-[15px]">{label}</span>
            <span className="flex rounded-md border border-line overflow-hidden text-sm">
              {(['show', 'filter', 'blur', 'block'] as const).map((v) => <button key={v} type="button" title={v === 'filter' ? 'Blur only pictures and videos that look explicit (checked on this device)' : undefined} onClick={() => save({ sensitive_media: { [k]: v } })} className={`px-3 py-1 capitalize ${(user.sensitive_media?.[k] ?? 'show') === v ? 'bg-accent text-white' : 'bg-bg-2 text-text-1 hover:bg-bg-3'}`} data-sensitive-option={v}>{v === 'block' ? 'Hide' : v}</button>)}
            </span>
          </div>
        ))}
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2">
        <h3 className="label">DM spam filter</h3>
        {([['none', 'Do not filter', 'Every message lands where it normally would.'], ['non_friends', 'Filter from non-friends', 'A suspicious first message from someone you are not friends with goes to the Spam folder in Message Requests.'], ['all', 'Filter all', 'Suspicious messages from anyone, friends included, are filtered.']] as const).map(([v, label, hint]) => (
          <label key={v} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${(user.spam_filter ?? 'non_friends') === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-1 hover:border-text-2'}`} data-spam-filter={v} data-on={(user.spam_filter ?? 'non_friends') === v ? '1' : '0'}>
            <input type="radio" name="spam_filter" className="mt-1 accent-accent" checked={(user.spam_filter ?? 'non_friends') === v} onChange={() => save({ spam_filter: v })} />
            <span><span className="block text-[15px]">{label}</span><span className="block text-xs text-text-2">{hint}</span></span>
          </label>
        ))}
        <p className="text-xs text-text-2">Suspicious means a link from an account under a week old, or the usual bait ("free nitro", "giveaway"…).</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2">
        <h3 className="label">Direct messages — who can message you</h3>
        <Radio value="everyone" label="Everyone" hint="Anyone on this server can send you a direct message." />
        <Radio value="friends_and_servers" label="Friends and server members" hint="Only your friends and people you share a server with." />
        <Radio value="friends" label="Friends only" hint="Only your friends. Everyone else sees their message bounce." />
        <div className="pt-2">
          <Toggle label="Allow direct messages from server members" checked={user.guild_dms_default !== false} onChange={(v) => save({ guild_dms_default: v })} />
          <p className="text-xs text-text-2 mt-1 mb-3">The default for servers you join when "Friends and server members" is selected. Change it for one server from the server menu → Privacy Settings.</p>
          <Toggle label="Message requests" checked={user.message_requests !== false} onChange={(v) => save({ message_requests: v })} />
          <p className="text-xs text-text-2 mt-1">Messages from people you are not friends with wait in Message Requests until you accept them, and never ring or ping you. Off: they go straight to your DM list.</p>
        </div>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2" data-search-section>
        <h3 className="label">Finding you</h3>
        <Toggle label="Let people find me by searching" checked={!!user.searchable} onChange={(v) => save({ searchable: v })} />
        <p className="text-xs text-text-2">On: your name shows up when people search for part of it. Off: people need your exact username to find you or send a friend request. Your friends can always find you.</p>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-1">
        <h3 className="label">Friend requests — who can send you one</h3>
        <Check value="everyone" label="Everyone" hint="Anyone who knows your username." />
        <Check value="friends_of_friends" label="Friends of friends" hint="People who share a friend with you." />
        <Check value="server_members" label="Server members" hint="People you share a server with." />
        {from.length === 0 && <p className="text-xs text-warn">Nobody can send you friend requests right now. You can still send them.</p>}
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-2">
        <h3 className="label">Group chats — who can add you</h3>
        <Toggle label="Friends can add me to group chats" checked={user.group_dm_privacy !== 'nobody'} onChange={(v) => save({ group_dm_privacy: v ? 'friends' : 'nobody' })} />
        <p className="text-xs text-text-2">Off: nobody can add you to a group; you can still create or join one yourself.</p>
      </section>
    </div>
  )
}
