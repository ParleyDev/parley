/**
 * What's New: release notes shown once when a new entry lands (Settings → What's New shows them any time). Newest
 * first; `id` only has to change for a new entry. Notes are written in English.
 * Every release adds one: `node scripts/changelog-draft.mjs` drafts it from the commits since the last entry, and the
 * commit-msg hook (scripts/changelog-check.mjs) refuses a `chore(release)` commit without one.
 */
export interface ChangelogEntry { id: string; date: string; title: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-11-19', date: '2026-11-19', title: 'Communities, the Studio and a lot more',
    items: [
      'Communities: group a server\'s channels into communities, each with its own page. Follow the ones you like and find them in your sidebar.',
      'The Studio: make music together in a project channel, with a DAW the whole band edits live. Record takes, play MIDI, add effects in plug-in style windows, mix and export.',
      'Videos play right in the chat, and audio files get a player with live visualisers that keeps playing when you leave the channel.',
      'Schedule a message and Parley sends it for you later.',
      'Invite links open a proper page showing the server, its members and online count, even before you log in. Owners can add a peek at a channel.',
      'Try Parley as a guest, no account needed.',
      'Zoom and position your profile picture, banner and server icons, and pick profile cosmetics with a live preview.',
      'Download a server as a template file, and create a server from any template.',
      'On phones, share to Parley from other apps, and menus are sheets you swipe away.',
      'Calls that can\'t connect directly now go through a relay, and emoji, flags included, look the same everywhere.',
      'Server and channel settings open in the same window as your own settings, and a new user guide sits behind every Help button.',
      'The desktop app lets you choose the stable or development update channel.',
    ],
  },
  {
    id: '2026-10-27', date: '2026-10-27', title: 'Play, listen and talk your way',
    items: [
      'Parley speaks 14 languages, including Arabic laid out right to left. Pick one in Settings → Language.',
      'Activities in calls: start Watch Together or Tic-Tac-Toe from the call bar, and apps can bring their own.',
      'Link Spotify to show what you are listening to, and Listen Along with friends.',
      'Set an activity yourself ("Playing …") from the status dialog, and choose whether to share it in Data & Privacy.',
      'Live captions, enhanced noise suppression and screen share sound in calls.',
      'Translate messages and get AI summaries of busy channels, when your server offers them.',
      'The desktop app gets a tray icon, push to talk that works in the background, and Streamer Mode that follows OBS.',
      'Install Parley as an app from your browser and get push notifications, with tabs on phones.',
      'Pick a house badge for your profile in Settings → Profiles.',
    ],
  },
  {
    id: '2026-10-26', date: '2026-10-26', title: 'Bots, safety and a lot more',
    items: [
      'Bots with slash commands, buttons and forms; webhooks with rich embeds; an App Directory.',
      'AutoMod, warnings, Moderator View, bulk bans and ban appeals.',
      'Private threads, forum guidelines and tags, polls with emoji, Remind Me.',
      'Soundboard with entrance sounds, priority speaker, call reactions and stream previews.',
      'Profile frames, nameplates and effects, server tags and server profiles.',
    ],
  },
]

const KEY = 'parley.whatsNewSeen'

/** The newest entry if this device hasn't shown it yet. A device that has never seen any just remembers the newest
 *  (new accounts and fresh browsers don't get a pop-up on their first visit). */
export function unseenEntry(): ChangelogEntry | null {
  const latest = CHANGELOG[0]
  try {
    const seen = localStorage.getItem(KEY)
    if (!seen) { localStorage.setItem(KEY, latest.id); return null }
    return seen === latest.id ? null : latest
  } catch { return null }
}
export function markSeen() { try { localStorage.setItem(KEY, CHANGELOG[0].id) } catch { /* ignore */ } }
