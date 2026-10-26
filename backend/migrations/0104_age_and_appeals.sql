-- Age: a birth date (set once by the user) gates 18+ channels and turns on teen safety defaults for under-18s.
ALTER TABLE users ADD COLUMN birthdate DATE;
-- Ban appeals: a banned member asks the server's moderators to reconsider, once per ban.
CREATE TABLE ban_appeals (
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'denied')),
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);
