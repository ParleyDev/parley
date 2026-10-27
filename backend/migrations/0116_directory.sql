-- Directory channels: a channel that lists servers (a hub's clubs, a community's sister servers). Each entry keeps a
-- lasting invite so members can join from the list.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'stage', 'studio', 'dm', 'group', 'category', 'thread', 'forum', 'directory'));
CREATE TABLE directory_entries (
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'other',
    invite_code TEXT NOT NULL,
    added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, guild_id)
);
