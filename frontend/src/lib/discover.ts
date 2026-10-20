export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'gaming', label: 'Gaming' },
  { id: 'music', label: 'Music' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'science_tech', label: 'Science & Tech' },
  { id: 'education', label: 'Education' },
  { id: 'student_hubs', label: 'Student Hubs' },
  { id: 'community', label: 'Community' },
]
export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id

export interface Listing {
  guild_id: string
  name: string
  icon_url: string | null
  description: string
  category: string
  banner_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  note: string
  submitted_at: string
  reviewed_at: string | null
  member_count: number
  online_count: number
  joined: boolean
  /** Admin-chosen spot on the Discover home page; null = not featured. */
  featured_order: number | null
  /** Admin-granted badge: the instance vouches for this server. */
  verified: boolean
}

/** Starter channel sets for "Create Your Server"; every server also gets #general and a General voice channel. */
export const TEMPLATES: { id: string; label: string; emoji: string; text: string[]; voice: string[] }[] = [
  { id: 'gaming', label: 'Gaming', emoji: '🎮', text: ['clips-and-highlights', 'looking-for-group'], voice: ['Lobby', 'Gaming'] },
  { id: 'friends', label: 'Friends', emoji: '💗', text: ['games', 'music', 'memes'], voice: ['Lounge'] },
  { id: 'study', label: 'Study Group', emoji: '🍎', text: ['homework-help', 'study-sessions', 'resources'], voice: ['Study Room'] },
  { id: 'club', label: 'School Club', emoji: '📚', text: ['announcements', 'meeting-plans', 'off-topic'], voice: ['Meeting Room'] },
  { id: 'community', label: 'Local Community', emoji: '🌲', text: ['announcements', 'events', 'meetups'], voice: ['Community Hall'] },
  { id: 'creators', label: 'Artists & Creators', emoji: '🎨', text: ['showcase', 'critique', 'resources'], voice: ['Creator Lounge'] },
]
