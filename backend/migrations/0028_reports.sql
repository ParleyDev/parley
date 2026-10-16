-- User reports (a message or a user) reviewed in the admin console.
CREATE TABLE reports (
    id               UUID PRIMARY KEY,
    reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    kind             TEXT NOT NULL,                 -- 'message' | 'user'
    target_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    target_username  TEXT NOT NULL DEFAULT '',
    message_id       UUID,                          -- not a FK: the snapshot must outlive deletion
    channel_id       UUID,
    channel_name     TEXT NOT NULL DEFAULT '',
    guild_id         UUID,
    guild_name       TEXT NOT NULL DEFAULT '',
    content          TEXT NOT NULL DEFAULT '',      -- message text at report time
    reason           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open',  -- open | resolved | dismissed
    resolved_by      UUID,
    resolved_at      TIMESTAMPTZ,
    note             TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, id DESC);
