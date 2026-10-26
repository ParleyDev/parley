-- How members joined (the invite code, or 'discover') and who invited them, for moderators; temporary-membership
-- invites, whose members are removed when they go offline unless they have been given a role.
ALTER TABLE guild_members ADD COLUMN joined_via TEXT, ADD COLUMN inviter_id UUID, ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invites ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT false;
