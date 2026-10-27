-- A security key as the second factor uses its own challenge kind.
ALTER TABLE webauthn_challenges DROP CONSTRAINT IF EXISTS webauthn_challenges_kind_check;
ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_kind_check CHECK (kind IN ('register', 'auth', 'discoverable', 'mfa'));
