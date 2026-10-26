-- Safety: quarantined members (read-only, like an open-ended timeout) and safety flags on members (e.g. joined
-- during a raid); raid protection per server (pause invites when joins spike, alert a channel); a cool-down for
-- people opening too many new DMs; and an instance blocklist of malicious link domains (seeded with IP loggers).
ALTER TABLE guild_members
  ADD COLUMN quarantined BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN flags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE guilds
  ADD COLUMN raid_protection BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN raid_threshold INT NOT NULL DEFAULT 10,
  ADD COLUMN safety_alerts_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN dm_spam_until TIMESTAMPTZ;
CREATE TABLE blocked_domains (
    domain     TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO blocked_domains (domain, reason) VALUES
  ('grabify.link', 'IP logger'), ('iplogger.org', 'IP logger'), ('iplogger.com', 'IP logger'), ('2no.co', 'IP logger'),
  ('yip.su', 'IP logger'), ('blasze.com', 'IP logger'), ('ps3cfw.com', 'IP logger'), ('lovebird.guru', 'IP logger')
ON CONFLICT DO NOTHING;
