-- Linked external accounts (Settings → Connections), shown on the profile when visible.
CREATE TABLE connections (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL DEFAULT '',
    visible     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider, external_id)
);
CREATE INDEX connections_user_idx ON connections(user_id);
