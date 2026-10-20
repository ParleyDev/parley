-- Recording Studio: a voice channel with one engineer, a band (artists) and an audience, where the engineer records
-- sessions as multitrack audio: every artist's client records its own mic and streams it up as a separate track.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'stage', 'studio', 'dm', 'group', 'category', 'thread', 'forum'));
ALTER TABLE channels ADD COLUMN engineer_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE studio_sessions (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    started_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ
);
CREATE INDEX studio_sessions_channel_idx ON studio_sessions(channel_id, started_at DESC);
CREATE TABLE studio_tracks (
    id           UUID PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL DEFAULT 'audio/webm',
    size         BIGINT NOT NULL DEFAULT 0,
    duration_ms  INT,
    offset_ms    INT NOT NULL DEFAULT 0,
    done         BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
