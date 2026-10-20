-- Per-server privacy: allow direct messages from members of this server (NULL = the user's default).
ALTER TABLE users ADD COLUMN guild_dms_default BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE guild_members ADD COLUMN allow_dms BOOLEAN;
