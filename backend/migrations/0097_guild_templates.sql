-- Server templates: a snapshot of a server's roles, channels, permissions and settings, shared by a link that creates
-- a new server from it. One per server, like Discord.
CREATE TABLE guild_templates (
    code        TEXT PRIMARY KEY,
    guild_id    UUID NOT NULL UNIQUE REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    creator_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    snapshot    JSONB NOT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
