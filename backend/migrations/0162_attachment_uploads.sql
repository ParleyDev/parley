-- Files uploaded in parts (each request under a proxy's body limit, such as Cloudflare's 100 MB): one row per upload
-- in progress, its bytes appended to UPLOAD_DIR/<id>.part until `received` reaches `size`, when it becomes an
-- attachment with the same id. Rows a day old are swept with their part files.
CREATE TABLE attachment_uploads (
    id           UUID PRIMARY KEY,
    uploader_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL,
    received     BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachment_uploads_created_idx ON attachment_uploads(created_at);
