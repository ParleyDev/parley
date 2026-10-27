-- Which browser sessions were sent a notification for which channel, so reading the channel on one device can
-- clear it on the others (a "clear" push only goes where there is something to clear).
CREATE TABLE web_push_sent (
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, channel_id)
);
