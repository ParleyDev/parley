-- Per-user notification settings for a server or a channel (a channel row overrides its server's).
CREATE TABLE notification_settings (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id         UUID NOT NULL,                       -- guild id, guild channel id or DM channel id
    level             TEXT NOT NULL DEFAULT 'default' CHECK (level IN ('default', 'all', 'mentions', 'nothing')),
    muted_until       TIMESTAMPTZ,                         -- NULL = not muted; far future = until turned back on
    suppress_everyone BOOLEAN NOT NULL DEFAULT false,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_id)
);
