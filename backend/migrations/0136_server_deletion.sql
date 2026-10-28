-- Phase 6 (docs/admin-access-and-server-deletion.md): server deletion and takedowns.
--
-- A server being deleted by its owner (pending_deletion, restorable by the owner for SERVER_DELETION_GRACE_DAYS) or
-- taken down by Trust & Safety (taken_down, never restorable by the owner, content kept for TAKEDOWN_RETENTION_DAYS and
-- reachable only through its case) is gone for members at once. When the time comes the finalize job hard-deletes the
-- server and everything in it, and leaves a tombstone with only the id, when and how: no name, icon, description or owner.
ALTER TABLE guilds
    ADD COLUMN state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending_deletion', 'taken_down')),
    ADD COLUMN deletion_requested_at TIMESTAMPTZ,
    ADD COLUMN deletion_scheduled_for TIMESTAMPTZ,
    ADD COLUMN deletion_type TEXT CHECK (deletion_type IN ('owner', 'takedown')),
    ADD COLUMN takedown_case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
CREATE INDEX guilds_deletion_due_idx ON guilds (deletion_scheduled_for) WHERE state <> 'active';

CREATE TABLE guild_tombstones (
    id             UUID PRIMARY KEY,
    deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deletion_type  TEXT NOT NULL CHECK (deletion_type IN ('owner', 'takedown', 'admin'))
);

-- Forwards are copies that live on in the conversation they were forwarded into; when their source server is deleted
-- the pointer is cleared and they read "Forwarded from a server that's no longer available".
ALTER TABLE messages ADD COLUMN forwarded_unavailable BOOLEAN NOT NULL DEFAULT false;

-- Preservation: before a server is finalized, the in-scope content of every open case that reaches into it is copied
-- here (messages as JSON, attachment files under the upload dir's cases/ folder), kept under case retention.
CREATE TABLE case_snapshots (
    id          UUID PRIMARY KEY,
    case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    guild_id    UUID NOT NULL,
    taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    messages    JSONB NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX case_snapshots_case_idx ON case_snapshots (case_id);
