-- Server notification dialog: mobile push on/off per server or channel, opting out of highlights, and muting
-- scheduled-event notifications.
ALTER TABLE notification_settings
  ADD COLUMN mobile_push BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN suppress_highlights BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN mute_events BOOLEAN NOT NULL DEFAULT false;
