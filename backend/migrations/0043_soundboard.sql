-- Soundboard: short per-server sounds (file on disk under UPLOAD_DIR by id) that members play into a voice channel.
CREATE TABLE sounds (
    id           UUID PRIMARY KEY,
    guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    emoji        TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL,
    volume       REAL NOT NULL DEFAULT 1.0,
    creator_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, name)
);
