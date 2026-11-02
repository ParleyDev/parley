-- Listen counts by listening session: each counted play is a row keyed by the client's session id, so a play the
-- phone retries after a dropped connection or an app restart counts once. media_ms: an audio file's length, from its
-- visualiser data, so clients needn't fetch the file to show it.
ALTER TABLE attachments ADD COLUMN media_ms INT;
CREATE TABLE attachment_plays (
    id            UUID PRIMARY KEY,
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    played_at     TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachment_plays_listener ON attachment_plays (attachment_id, user_id, played_at);
