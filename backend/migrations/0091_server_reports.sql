-- Reports can also go to the server's own moderators (to_mods), who track them separately from the instance admins
-- (mod_status / mod_note); and a whole server can be reported (kind 'guild').
ALTER TABLE reports
  ADD COLUMN to_mods BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN mod_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN mod_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN mod_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX reports_guild_mods_idx ON reports (guild_id, mod_status) WHERE to_mods;
