-- AFK voice channel (idle voice users are moved there after afk_timeout seconds), a designated #rules channel, and
-- the welcome screen new members see: {"enabled": bool, "description": text, "channels": [{"channel_id", "description", "emoji"}]}.
ALTER TABLE guilds
  ADD COLUMN afk_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN afk_timeout INT NOT NULL DEFAULT 300,
  ADD COLUMN rules_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN welcome_screen JSONB NOT NULL DEFAULT '{}'::jsonb;
