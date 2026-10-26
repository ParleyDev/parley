-- Settings that used to live only in each browser (appearance, chat and accessibility preferences, notification
-- sounds, keybinds), kept on the account so every device follows them.
ALTER TABLE users ADD COLUMN client_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
