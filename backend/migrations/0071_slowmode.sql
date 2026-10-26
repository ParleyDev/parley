-- Slowmode: how long (seconds, 0 = off, up to 6 hours) members wait between messages in a channel. Members who can
-- manage messages or the channel are exempt.
ALTER TABLE channels ADD COLUMN rate_limit_per_user INT NOT NULL DEFAULT 0;
