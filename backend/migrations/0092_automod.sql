-- AutoMod: per-server rules checked when members post (keywords, regexes, mention spam, link spam) or change their
-- server nickname (name filter). Actions: block (with a custom message), alert a channel, time the member out.
CREATE TABLE automod_rules (
    id                UUID PRIMARY KEY,
    guild_id          UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    enabled           BOOLEAN NOT NULL DEFAULT true,
    trigger           TEXT NOT NULL,                 -- keyword | mention_spam | link_spam | name
    keywords          TEXT[] NOT NULL DEFAULT '{}',
    regexes           TEXT[] NOT NULL DEFAULT '{}',
    allow             TEXT[] NOT NULL DEFAULT '{}',  -- allowed words, or allowed domains for link_spam
    mention_limit     INT NOT NULL DEFAULT 5,
    block             BOOLEAN NOT NULL DEFAULT true,
    block_message     TEXT NOT NULL DEFAULT '',
    alert_channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
    timeout_secs      INT NOT NULL DEFAULT 0,
    exempt_roles      UUID[] NOT NULL DEFAULT '{}',
    exempt_channels   UUID[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX automod_rules_guild_idx ON automod_rules (guild_id);
