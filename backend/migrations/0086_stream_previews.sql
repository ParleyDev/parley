-- The latest still from each live screen share, for the "Watch Stream" card (replaced every half minute or so).
CREATE TABLE stream_previews (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    image        BYTEA NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
