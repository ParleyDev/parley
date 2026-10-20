-- Voice message transcripts (filled by a background job when an STT server is configured) and who has listened.
ALTER TABLE attachments ADD COLUMN transcript TEXT;
ALTER TABLE attachments ADD COLUMN transcript_status TEXT;   -- NULL (n/a) | pending | done | failed
CREATE TABLE attachment_listens (
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (attachment_id, user_id)
);
