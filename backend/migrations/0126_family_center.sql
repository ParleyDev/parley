-- Family Center: a teen shows a parent a one-time code; once linked, the parent sees a weekly summary of the teen's
-- activity (servers joined, friends added, who they messaged and how much), never message content. Either side can
-- unlink.
CREATE TABLE family_codes (
    code       TEXT PRIMARY KEY,
    teen_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE family_links (
    parent_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teen_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (parent_id, teen_id)
);
CREATE INDEX family_links_teen ON family_links (teen_id);
