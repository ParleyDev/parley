/**
 * What's New: release notes shown once when a new entry lands (Settings → What's New shows them any time). Newest
 * first; `id` only has to change for a new entry. Notes are written in English.
 */
export interface ChangelogEntry { id: string; date: string; title: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
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
