-- Membership applications: new members answer the server's questions and wait for a moderator to approve them
-- (reusing the rules gate: rules_accepted_at stays null until approval).
ALTER TABLE guilds ADD COLUMN applications JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE guild_applications (
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answers    JSONB NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX guild_applications_pending ON guild_applications (guild_id, created_at) WHERE status = 'pending';
