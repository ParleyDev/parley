-- Bot invites: the bot's managed role (the permissions picked when it was added), app icons, public/private bots and
-- verified bots.
ALTER TABLE applications
  ADD COLUMN icon_url TEXT,
  ADD COLUMN bot_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN managed_app_id UUID REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN verified_bot BOOLEAN NOT NULL DEFAULT false;
