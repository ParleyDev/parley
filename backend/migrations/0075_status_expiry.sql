-- Statuses that end on their own: Idle / Do Not Disturb / Invisible "for 1 hour", and a custom status that clears
-- after a while (Discord's "Clear after"). A background task puts them back when the time is up.
ALTER TABLE users ADD COLUMN status_expires_at TIMESTAMPTZ, ADD COLUMN custom_status_expires_at TIMESTAMPTZ;
