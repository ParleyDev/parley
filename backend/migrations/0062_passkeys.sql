-- Passkeys (WebAuthn): an additional way to sign in; passwords stay. `passkey` is webauthn-rs's serialised
-- credential (public key, counter, backup state); `cred_id` is its credential id, unique across the instance.
CREATE TABLE passkeys (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    cred_id      BYTEA NOT NULL UNIQUE,
    passkey      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id);

-- In-progress registration / sign-in ceremonies, single use and short lived. Kept in Postgres so any backend
-- instance can finish a ceremony another one started.
CREATE TABLE webauthn_challenges (
    id         UUID PRIMARY KEY,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('register', 'auth', 'discoverable')),
    state      JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);
