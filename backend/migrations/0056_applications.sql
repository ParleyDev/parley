-- Developer applications, OAuth2 (authorization code) and bot accounts.
ALTER TABLE users ADD COLUMN bot BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE applications (
    id                 UUID PRIMARY KEY,
    owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    client_id          TEXT NOT NULL UNIQUE,
    client_secret_hash TEXT NOT NULL,
    redirect_uris      TEXT[] NOT NULL DEFAULT '{}',
    bot_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX applications_owner_idx ON applications(owner_id);
CREATE TABLE oauth_codes (
    code         TEXT PRIMARY KEY,
    app_id       UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ
);
CREATE TABLE oauth_tokens (
    id           UUID PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    app_id       UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('user', 'bot')),
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX oauth_tokens_user_idx ON oauth_tokens(user_id, app_id);
