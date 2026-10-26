-- Webhooks: post into a channel with a secret URL, no login. Each webhook has a hidden bot user as the author; a
-- message may override the name and avatar shown. Bots and webhooks can attach rich embeds.
CREATE TABLE webhooks (
    id         UUID PRIMARY KEY,
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    avatar_url TEXT,
    token_hash TEXT NOT NULL,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_channel ON webhooks (channel_id);
ALTER TABLE users ADD COLUMN webhook BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages
  ADD COLUMN webhook_id UUID,
  ADD COLUMN author_override JSONB,
  ADD COLUMN embeds JSONB;
