-- Server banners, and each user's own ordering/folders for the server bar.
ALTER TABLE guilds ADD COLUMN banner_url TEXT;
ALTER TABLE users ADD COLUMN guild_layout JSONB NOT NULL DEFAULT '[]';
