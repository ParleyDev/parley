-- Someone whose last connection just closed still shows online (or, a phone app put in the background, idle) for a
-- while: a page refresh, a network blip, a server restart or a glance at another app shouldn't flash them offline.
-- Pushes don't wait for this; they go by the live sockets in `presence`.
CREATE TABLE presence_linger (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    until TIMESTAMPTZ NOT NULL,
    idle BOOLEAN NOT NULL,
    platforms TEXT[] NOT NULL
);
