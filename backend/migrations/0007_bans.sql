-- Server bans. A banned user is removed from the server and cannot accept invites to it until unbanned.
CREATE TABLE guild_bans (
    guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);
