-- End-to-end encrypted calls, per channel: voice, stage and studio channels (Manage Channels) and DM / group calls
-- (any member). Clients that cannot encrypt media are refused when joining such a call.
ALTER TABLE channels ADD COLUMN e2ee BOOLEAN NOT NULL DEFAULT false;
