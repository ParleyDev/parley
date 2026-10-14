-- Forwarded messages remember their source; bookmarks are per-user saved messages.
ALTER TABLE messages ADD COLUMN forwarded_from UUID;

CREATE TABLE bookmarks (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, message_id)
);
