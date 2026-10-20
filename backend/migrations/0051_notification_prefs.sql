-- Notification preferences beyond per-target settings: push inactive timeout, email notifications,
-- defaults for servers you join. Activity time feeds the push timeout; notify_mailed_at throttles mail.
ALTER TABLE users ADD COLUMN notif_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN notify_mailed_at TIMESTAMPTZ;
ALTER TABLE notification_settings ADD COLUMN suppress_roles BOOLEAN NOT NULL DEFAULT false;
