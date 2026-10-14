-- Roles, member role assignments and per-channel permission overwrites.

CREATE TABLE roles (
    id          UUID PRIMARY KEY,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,                       -- '#rrggbb' or NULL for default
    position    INT NOT NULL DEFAULT 1,     -- 0 is @everyone; higher outranks lower
    permissions BIGINT NOT NULL DEFAULT 0,  -- bitfield, see perms.rs
    hoist       BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX roles_guild_idx ON roles(guild_id);

CREATE TABLE member_roles (
    guild_id UUID NOT NULL,
    user_id  UUID NOT NULL,
    role_id  UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id),
    FOREIGN KEY (guild_id, user_id) REFERENCES guild_members(guild_id, user_id) ON DELETE CASCADE
);

CREATE TABLE channel_overwrites (
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL,              -- role id or user id
    target_kind TEXT NOT NULL CHECK (target_kind IN ('role', 'member')),
    allow       BIGINT NOT NULL DEFAULT 0,
    deny        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, target_id)
);

-- Every guild gets an @everyone role whose id equals the guild id.
-- Default permissions: create invite, add reactions, video, view channels, send messages, connect, speak, change nickname.
INSERT INTO roles (id, guild_id, name, position, permissions)
SELECT id, id, '@everyone', 0, 70258241 FROM guilds;
