-- Threads: channels of kind 'thread' under a text channel (parent_id), optionally rooted at a message.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'dm', 'group', 'category', 'thread'));
CREATE TABLE threads (
    channel_id      UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    root_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX threads_root_idx ON threads (root_message_id);
