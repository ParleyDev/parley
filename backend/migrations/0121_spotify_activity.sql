-- Spotify as a status ("Listening to Spotify") and Listen Along. A Spotify link keeps its tokens; while the user is
-- online the server polls what they play and shares it as their activity, unless they turn that off.
ALTER TABLE connections
    ADD COLUMN show_activity BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN polled_at     TIMESTAMPTZ;

-- What someone is doing right now (one at a time), shared with everyone who can see them online.
CREATE TABLE activities (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    activity   JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listening along with someone: their Spotify follows the host's track.
CREATE TABLE listen_along (
    listener_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    host_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listen_along_host ON listen_along (host_id);
