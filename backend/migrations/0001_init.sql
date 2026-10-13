CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id            UUID PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url    TEXT,
    bio           TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'online',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE guilds (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    icon_url    TEXT,
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE guild_members (
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname   TEXT,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX guild_members_user_idx ON guild_members(user_id);

CREATE TABLE channels (
    id          UUID PRIMARY KEY,
    guild_id    UUID REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('text','voice','dm','group_dm')),
    topic       TEXT NOT NULL DEFAULT '',
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channels_guild_idx ON channels(guild_id);

-- members of DM / group DM channels
CREATE TABLE channel_members (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members(user_id);

CREATE TABLE messages (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    reply_to    UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at   TIMESTAMPTZ
);
CREATE INDEX messages_channel_created_idx ON messages(channel_id, id DESC);

CREATE TABLE reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE invites (
    code        TEXT PRIMARY KEY,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uses        INT NOT NULL DEFAULT 0,
    max_uses    INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE read_states (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_msg   UUID,
    PRIMARY KEY (user_id, channel_id)
);
