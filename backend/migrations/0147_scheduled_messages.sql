-- Scheduled messages: written now, sent by the server at send_at as the author (re-checked then like any message).
-- A send that fails stays here as 'failed' with the reason, for the author to edit, retry or delete.
CREATE TABLE scheduled_messages (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    reply_to UUID,
    attachment_ids UUID[] NOT NULL DEFAULT '{}',
    send_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    -- When a server picked it up to send ('sending'); a send that never finished is reported, not retried.
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_messages_due ON scheduled_messages (send_at) WHERE status = 'pending';
CREATE INDEX scheduled_messages_user ON scheduled_messages (user_id, send_at);
-- Server managers can turn scheduling off for the whole server; per channel it is the Schedule Messages permission
-- (1 << 31), which @everyone has by default.
ALTER TABLE guilds ADD COLUMN scheduled_off BOOLEAN NOT NULL DEFAULT false;
UPDATE roles SET permissions = permissions | 2147483648 WHERE id = guild_id;
