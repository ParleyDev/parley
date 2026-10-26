-- Moderator warnings: a reason the member is shown, kept for the moderator view and account standing.
CREATE TABLE member_warnings (
    id           UUID PRIMARY KEY,
    guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_warnings_member_idx ON member_warnings (guild_id, user_id, created_at DESC);
CREATE INDEX member_warnings_user_idx ON member_warnings (user_id, created_at DESC);
