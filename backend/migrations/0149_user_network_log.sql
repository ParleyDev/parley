-- Where each account has been seen from (IP and client), for the admin user page: sessions only keep the login IP
-- for 30 days, this keeps every address a signed-in client connected from, for 90 days. Readable through the
-- logged PII reveal only.
CREATE TABLE user_network_log (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip         TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    platform   TEXT NOT NULL DEFAULT '',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, ip, user_agent)
);
CREATE INDEX user_network_log_ip ON user_network_log (ip);
CREATE INDEX user_network_log_seen ON user_network_log (last_seen);
INSERT INTO user_network_log (user_id, ip, user_agent, first_seen, last_seen, hits)
SELECT user_id, ip, user_agent, MIN(created_at), MAX(last_seen_at), COUNT(*)::int FROM sessions WHERE ip <> '' GROUP BY user_id, ip, user_agent
ON CONFLICT DO NOTHING;
