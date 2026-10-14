CREATE TABLE attachments (
    id           UUID PRIMARY KEY,
    message_id   UUID REFERENCES messages(id) ON DELETE CASCADE,   -- NULL until the message is sent
    uploader_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL,
    width        INT,
    height       INT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments(message_id);
CREATE INDEX attachments_pending_idx ON attachments(created_at) WHERE message_id IS NULL;

-- New "Attach Files" permission (bit 15), on by default for @everyone.
UPDATE roles SET permissions = permissions | 32768 WHERE id = guild_id;
