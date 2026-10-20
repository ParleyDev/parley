-- Account changes from Settings → My Account: username changes are rate limited (one per day),
-- and an email change is confirmed from the new address (email_tokens kind 'change_email').
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_kind_check;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_kind_check CHECK (kind IN ('verify', 'reset', 'change_email'));
