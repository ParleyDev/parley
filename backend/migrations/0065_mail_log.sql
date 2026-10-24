-- Every email the server tried to send and what happened to it (sent / failed / logged / off), for the Admin
-- Console's Mail page. Kept for `mail_log_days` (0 = forever) unless an admin deletes entries sooner.
CREATE TABLE mail_log (
    id      UUID PRIMARY KEY,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body    TEXT NOT NULL,
    status  TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'logged', 'off')),
    error   TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mail_log_sent_idx ON mail_log(sent_at DESC);
CREATE INDEX mail_log_to_idx ON mail_log(lower(to_addr), sent_at DESC);
INSERT INTO instance_settings (key, value) VALUES ('mail_log_days', '30') ON CONFLICT DO NOTHING;
