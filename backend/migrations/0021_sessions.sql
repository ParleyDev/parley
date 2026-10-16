-- One row per login. Tokens carry the session id, so a session can be revoked on its own
-- ("log out that device") and listed with where/when it was last used.
CREATE TABLE sessions (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip           TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id, last_seen_at DESC);
