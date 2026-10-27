-- Server tags: a server's official short tag (and badge) that members can wear next to their name. Partnered servers.
ALTER TABLE guilds
  ADD COLUMN tag TEXT,
  ADD COLUMN tag_badge TEXT,
  ADD COLUMN partnered BOOLEAN NOT NULL DEFAULT false;
-- The server whose tag a user wears (null: their own free-text tag, or none).
ALTER TABLE users ADD COLUMN clan_tag_guild UUID REFERENCES guilds(id) ON DELETE SET NULL;
