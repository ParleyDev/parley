-- Instance-level action against an account, graded and reversible, and what watches for abuse across the instance.
--
-- A sanction is one of:
--   limit    a soft ban: the account keeps what it has but cannot start anything new (first messages to people it
--            is not friends with, friend requests, joining or creating servers, creating invites);
--   quiet    for confirmed spammers: first messages and friend requests look sent and reach nobody;
--   suspend  the account cannot sign in. With an expiry it is a temporary ban; `hard` also keeps its email address
--            and the network addresses it used from registering again.
CREATE TABLE account_sanctions (
    id         UUID PRIMARY KEY,
    -- Kept when the account is removed, so a hard ban's markers outlive it.
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('limit', 'quiet', 'suspend')),
    reason     TEXT NOT NULL CHECK (reason IN ('spam', 'underage', 'evasion', 'abuse', 'other')),
    note       TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'auto')),
    hard       BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lifted_at  TIMESTAMPTZ,
    lifted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    lift_note  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX account_sanctions_active ON account_sanctions (user_id) WHERE lifted_at IS NULL;

-- What a hard ban remembers: keyed hashes (never the values) of the email address and of the network addresses.
-- A matching email cannot register. A matching address only raises a flag, because addresses are shared.
CREATE TABLE ban_markers (
    sanction_id UUID NOT NULL REFERENCES account_sanctions(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('email', 'ip')),
    value_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sanction_id, kind, value_hash)
);
CREATE INDEX ban_markers_lookup ON ban_markers (kind, value_hash);

-- The review queue: everything a detector noticed, and the action taken automatically (if any), for a person to
-- confirm or undo.
CREATE TABLE abuse_flags (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,       -- duplicate_text | link_spam | mention_spam | dm_burst | friend_burst | reports | evasion
    details     JSONB NOT NULL DEFAULT '{}'::jsonb,
    sanction_id UUID REFERENCES account_sanctions(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    outcome     TEXT NOT NULL DEFAULT ''   -- kept | undone | dismissed
);
CREATE INDEX abuse_flags_open ON abuse_flags (created_at) WHERE reviewed_at IS NULL;
CREATE INDEX abuse_flags_user ON abuse_flags (user_id, kind, created_at);

-- Short-lived counters for the detectors (pruned after a day). `hash` is a digest of normalised text, never text.
CREATE TABLE abuse_events (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    target  UUID,
    hash    TEXT NOT NULL DEFAULT '',
    n       INT NOT NULL DEFAULT 1,
    at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX abuse_events_user ON abuse_events (user_id, kind, at);
CREATE INDEX abuse_events_at ON abuse_events (at);
