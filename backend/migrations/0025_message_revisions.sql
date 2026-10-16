-- Previous versions of edited messages ("show original"). One row per edit, holding the content that was replaced.
CREATE TABLE message_revisions (
    id          UUID PRIMARY KEY,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX message_revisions_msg_idx ON message_revisions (message_id, id);
