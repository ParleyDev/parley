-- Account deletion: soft delete, then anonymize. A deleting account is 'pending_deletion' for a grace period (it
-- can be restored by signing in), then 'deleted': the row stays (same id, so every reference stays valid) with all
-- personal data scrubbed. See docs/account-deletion.md.
ALTER TABLE users
    ADD COLUMN account_state TEXT NOT NULL DEFAULT 'active' CHECK (account_state IN ('active', 'pending_deletion', 'deleted')),
    ADD COLUMN deletion_requested_at TIMESTAMPTZ,
    ADD COLUMN deletion_scheduled_for TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ALTER COLUMN email DROP NOT NULL,
    ALTER COLUMN password_hash DROP NOT NULL;
CREATE INDEX users_deletion_due ON users (deletion_scheduled_for) WHERE account_state = 'pending_deletion';

-- Only for accounts deleted while suspended or banned from a server: a keyed hash (HMAC) of the email, so the same
-- address can't sign up again straight away to dodge the ban. Never linked to the account; expires.
CREATE TABLE deletion_email_blocks (
    email_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);
