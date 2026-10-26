-- Channels & Roles: roles members may give themselves, channels each member hides from their list (Browse
-- Channels), and onboarding questions whose answers grant roles and show channels.
ALTER TABLE roles ADD COLUMN self_assignable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guild_members
  ADD COLUMN hidden_channels UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN onboarded_at TIMESTAMPTZ;
ALTER TABLE guilds ADD COLUMN onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;
