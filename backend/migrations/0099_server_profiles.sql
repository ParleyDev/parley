-- Per-server profiles (avatar, banner, bio, pronouns that override your main profile in one server) and shareable
-- invite links for group DMs.
ALTER TABLE guild_members
  ADD COLUMN guild_avatar TEXT,
  ADD COLUMN guild_banner TEXT,
  ADD COLUMN guild_bio TEXT NOT NULL DEFAULT '',
  ADD COLUMN guild_pronouns TEXT NOT NULL DEFAULT '';
CREATE TABLE group_invites (
    code       TEXT PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX group_invites_channel ON group_invites (channel_id);
