-- Server-wide explicit image filter: off, for members without roles, or for everyone. Detection runs in clients
-- (on-device model); the setting tells them whose media to check.
ALTER TABLE guilds ADD COLUMN explicit_filter TEXT NOT NULL DEFAULT 'off' CHECK (explicit_filter IN ('off', 'no_roles', 'all'));
