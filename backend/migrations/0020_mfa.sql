-- Two-factor authentication: TOTP secret (base32), a pending secret during enrolment,
-- the last accepted time step (replay guard) and hashed single-use backup codes.
ALTER TABLE users
    ADD COLUMN totp_secret TEXT,
    ADD COLUMN totp_pending TEXT,
    ADD COLUMN totp_enabled_at TIMESTAMPTZ,
    ADD COLUMN totp_last_step BIGINT NOT NULL DEFAULT 0;

CREATE TABLE mfa_backup_codes (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, code_hash)
);
