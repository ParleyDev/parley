-- Voice moderation and channel options: server mute and deafen stay on the member (as in Discord) until lifted;
-- voice channels get a user limit (0 = none) and a short status that clears when the channel empties.
ALTER TABLE guild_members ADD COLUMN mute BOOLEAN NOT NULL DEFAULT false, ADD COLUMN deaf BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN user_limit INT NOT NULL DEFAULT 0, ADD COLUMN voice_status TEXT NOT NULL DEFAULT '';
