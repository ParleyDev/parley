-- Disable account (reversible: cleared on next login) and "Request all of my data" exports.
ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;
CREATE TABLE data_exports (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | ready | failed
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at     TIMESTAMPTZ,
    size         BIGINT NOT NULL DEFAULT 0,
    error        TEXT
);
CREATE INDEX data_exports_user_idx ON data_exports(user_id, requested_at DESC);
