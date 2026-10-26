-- Profile extras: your last avatars (quick switch back), who sees your bio/banner/pronouns/panels ('everyone' or
-- 'friends'), and cosmetics: a profile card frame, a nameplate behind your name in lists, and a profile effect.
ALTER TABLE users
  ADD COLUMN avatar_history TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN profile_privacy TEXT NOT NULL DEFAULT 'everyone',
  ADD COLUMN profile_frame TEXT NOT NULL DEFAULT '',
  ADD COLUMN nameplate TEXT NOT NULL DEFAULT '',
  ADD COLUMN profile_effect TEXT NOT NULL DEFAULT '';
