-- Server widget (public JSON and an embeddable page: online members and a Join link to the chosen invite) and an
-- invite splash: a background picture for the server's invite page.
ALTER TABLE guilds
  ADD COLUMN widget_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN widget_invite TEXT NOT NULL DEFAULT '',
  ADD COLUMN invite_splash_url TEXT;
