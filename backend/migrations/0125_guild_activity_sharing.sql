-- Per-server activity sharing (Server menu → Privacy Settings): off hides your activity from that server's members
-- (friends and people you DM with still see it).
ALTER TABLE guild_members ADD COLUMN share_activity BOOLEAN NOT NULL DEFAULT true;
