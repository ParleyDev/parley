-- Server overview and safety settings (Discord's): a description; where join notices go and whether to show them
-- (with a "wave to say hi" prompt); the default notification level for new members; verification level (0 none,
-- 1 verified email, 2 also an account older than 5 minutes, 3 also a member for 10 minutes); 2FA required for
-- moderator powers (1); paused invites; and DMs between members paused until a time.
ALTER TABLE guilds
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN system_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN join_notices BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN join_wave BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN default_notifications TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN verification_level SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN mfa_level SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN invites_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dms_paused_until TIMESTAMPTZ;
