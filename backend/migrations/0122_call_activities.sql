-- Activities in calls: built-in ones (Watch Together, Tic-Tac-Toe) and apps that set an activity URL, run as
-- embedded pages that talk to the client through the activity SDK. One session per activity per call.
ALTER TABLE applications ADD COLUMN activity_url TEXT;

CREATE TABLE call_activities (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    -- A built-in's name ('watch', 'tictactoe') or 'app:<application id>'.
    key         TEXT NOT NULL,
    app_id      UUID REFERENCES applications(id) ON DELETE CASCADE,
    -- Who hears about it: the server, or the people in a DM call.
    guild_id    UUID REFERENCES guilds(id) ON DELETE CASCADE,
    peers       UUID[] NOT NULL DEFAULT '{}',
    started_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Shared state the activity keeps (last write wins), handed to everyone who joins.
    state       JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, key)
);

CREATE TABLE call_activity_members (
    activity_id UUID NOT NULL REFERENCES call_activities(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX call_activity_members_user ON call_activity_members (user_id);
