-- Custom status text ("😂 doing things"), pinned messages.
ALTER TABLE users ADD COLUMN custom_status TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN pinned_at TIMESTAMPTZ;
CREATE INDEX messages_pinned_idx ON messages(channel_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;
