-- Email verification (and, later, password reset) tokens. Existing accounts are grandfathered in.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = now();

CREATE TABLE email_tokens (
    token      TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
    email      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ
);
CREATE INDEX email_tokens_user_idx ON email_tokens(user_id, kind);

INSERT INTO instance_settings (key, value) VALUES ('require_email_verification', 'false') ON CONFLICT DO NOTHING;
