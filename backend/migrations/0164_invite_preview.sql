-- The channel whose last few messages the logged-out invite page shows (must stay readable by @everyone to be used).
ALTER TABLE guilds ADD COLUMN invite_preview_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
