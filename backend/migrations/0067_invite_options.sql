-- Invite expiry and vanity links. expires_at NULL never expires. Vanity invites are custom, lowercase codes that
-- servers approved for Discovery may claim (up to three); they never expire, have no use limit and only resolve while
-- the server stays approved.
ALTER TABLE invites ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE invites ADD COLUMN vanity BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX invites_guild_idx ON invites(guild_id);
CREATE UNIQUE INDEX invites_code_lower_idx ON invites(lower(code)) WHERE vanity;
