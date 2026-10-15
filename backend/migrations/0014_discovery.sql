-- Parley admins and the server discovery directory (submitted by servers, approved by admins).
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE guild_discovery (
    guild_id     UUID PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'community',
    banner_url   TEXT,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    note         TEXT NOT NULL DEFAULT '',
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at  TIMESTAMPTZ
);
CREATE INDEX guild_discovery_status_idx ON guild_discovery(status);
