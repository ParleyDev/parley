-- README badge settings per server (Server Settings › Badge): on/off, label, colour, which counts to show and the
-- default style. Missing keys use the defaults, so existing badges keep looking the same.
ALTER TABLE guilds ADD COLUMN badge JSONB NOT NULL DEFAULT '{}'::jsonb;
