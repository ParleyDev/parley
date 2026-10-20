-- Stage channels: a voice channel where only speakers are heard; everyone else joins as audience and can raise a hand.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'stage', 'dm', 'group', 'category', 'thread', 'forum'));

-- Scheduled events: a time, a place (a voice/stage channel or an external location), RSVPs.
CREATE TABLE guild_events (
    id          UUID PRIMARY KEY,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ,
    channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
    location    TEXT NOT NULL DEFAULT '',
    creator_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_events_guild_start_idx ON guild_events(guild_id, starts_at);
CREATE TABLE event_rsvps (
    event_id   UUID NOT NULL REFERENCES guild_events(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);
