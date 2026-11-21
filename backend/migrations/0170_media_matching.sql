-- Matching uploads against known abuse material (src/routes/matching.rs). Off until an administrator supplies a hash
-- list or the address of a matching service they are vetted to use.
--
-- blocked_file_hashes: SHA-256 values of files that must never be stored or served, with the label of the list they
-- came from. An exact-hash list only catches byte-identical copies; the matching service is what catches re-encoded ones.
CREATE TABLE blocked_file_hashes (
    sha256   TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    source   TEXT NOT NULL DEFAULT '',
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blocked_file_hashes_source ON blocked_file_hashes (source);

-- media_matches: one row per upload that matched. The file itself is held in quarantine (UPLOAD_DIR/quarantine/<id>,
-- never served by any route) as evidence; the row says who sent it, from where and what it matched, and tracks the
-- review: open -> reported (a report was filed with the authority, with its reference) or released (a false match:
-- the account is restored and the file destroyed) -> closed. Rows outlive the account (the user id is cleared, the
-- name as it was is kept) and are under legal hold until someone with the review permission lifts it.
CREATE TABLE media_matches (
    id           UUID PRIMARY KEY,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    username     TEXT NOT NULL DEFAULT '',
    surface      TEXT NOT NULL,
    channel_id   UUID,
    guild_id     UUID,
    filename     TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '',
    size         BIGINT NOT NULL DEFAULT 0,
    sha256       TEXT NOT NULL,
    source       TEXT NOT NULL,
    reference    TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT '',
    ip           TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    quarantined  BOOLEAN NOT NULL DEFAULT false,
    suspended    BOOLEAN NOT NULL DEFAULT false,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reported', 'released', 'closed')),
    report_ref   TEXT NOT NULL DEFAULT '',
    reported_at  TIMESTAMPTZ,
    note         TEXT NOT NULL DEFAULT '',
    legal_hold   BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at   TIMESTAMPTZ
);
CREATE INDEX media_matches_status ON media_matches (status, created_at DESC);
CREATE INDEX media_matches_user ON media_matches (user_id);
