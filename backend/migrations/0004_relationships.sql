-- Friends, pending requests and blocks, one row per (owner, target) like Discord.
CREATE TABLE relationships (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('friend', 'outgoing', 'incoming', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_id)
);
CREATE INDEX relationships_target_idx ON relationships(target_id);
