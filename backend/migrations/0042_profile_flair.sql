-- Profile flair: avatar decoration (preset frame), clan tag (short tag next to the name) and optional profile panels
-- (wishlist / game collection) stored as JSON.
ALTER TABLE users ADD COLUMN avatar_decoration TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN clan_tag TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN panels JSONB NOT NULL DEFAULT '{}'::jsonb;
