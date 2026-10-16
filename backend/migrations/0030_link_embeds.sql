-- Cached OpenGraph previews for links in messages (status: ok | none).
CREATE TABLE link_embeds (
    url        TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
