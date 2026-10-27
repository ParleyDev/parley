-- A status people set by hand ("Playing Factorio"), shown while Spotify isn't, and a switch to share none at all.
ALTER TABLE users
    ADD COLUMN custom_activity JSONB,
    ADD COLUMN share_activity  BOOLEAN NOT NULL DEFAULT true;
