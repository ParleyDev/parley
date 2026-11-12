-- A project's sessions: live gatherings in its voice room with a beginning and an end, like a Stage. An engineer
-- starts one with a title; everyone who joins while it runs is noted; it ends when an engineer ends it. The takes
-- recorded in between belong to it (by time). Not to be confused with studio_sessions, which are single takes.
CREATE TABLE studio_gatherings (
    id         UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    started_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ,
    people     UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX studio_gatherings_channel_idx ON studio_gatherings(channel_id, started_at DESC);
CREATE UNIQUE INDEX studio_gatherings_open_idx ON studio_gatherings(channel_id) WHERE ended_at IS NULL;
