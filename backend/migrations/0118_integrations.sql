-- Twitch / YouTube server integrations: a creator links their channel with subscriber access, the server gets a
-- managed role, and members whose linked account subscribes (or is a channel member) hold it.
ALTER TABLE connections
    ADD COLUMN creator          BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN access_token     TEXT,
    ADD COLUMN refresh_token    TEXT,
    ADD COLUMN token_expires_at TIMESTAMPTZ;

CREATE TABLE guild_integrations (
    id            UUID PRIMARY KEY,
    guild_id      UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube')),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    role_id       UUID REFERENCES roles(id) ON DELETE SET NULL,
    added_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    synced_at     TIMESTAMPTZ,
    member_count  INT NOT NULL DEFAULT 0,
    last_error    TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, provider)
);
