-- Member timeouts: until this instant the member can only read (no send/react/attach/voice).
ALTER TABLE guild_members ADD COLUMN timeout_until TIMESTAMPTZ;
