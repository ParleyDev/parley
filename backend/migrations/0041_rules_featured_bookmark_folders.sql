-- Membership screening: optional server rules members must accept before chatting.
ALTER TABLE guilds ADD COLUMN rules TEXT NOT NULL DEFAULT '';
ALTER TABLE guilds ADD COLUMN rules_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guild_members ADD COLUMN rules_accepted_at TIMESTAMPTZ;
-- Discover: admin-chosen featured order (NULL = not featured) and a verified badge that means more than approval.
ALTER TABLE guild_discovery ADD COLUMN featured_order INT;
ALTER TABLE guild_discovery ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;
-- Bookmarks: folders and manual order.
ALTER TABLE bookmarks ADD COLUMN folder TEXT NOT NULL DEFAULT '';
ALTER TABLE bookmarks ADD COLUMN position INT NOT NULL DEFAULT 0;
