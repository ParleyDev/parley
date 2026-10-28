-- Phase 2 (docs/admin-access-and-server-deletion.md): admin content access goes through a case. A report opens one;
-- admins open investigation and legal cases with a justification and an explicit scope (channels and a time range).
-- Reading beyond a report's context window, and anything inside a DM or group chat, needs a grant approved by a
-- T&S lead who is not the requester, limited to the case scope and expiring.
CREATE TABLE cases (
    id                 UUID PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('report', 'investigation', 'legal')),
    subject_kind       TEXT NOT NULL CHECK (subject_kind IN ('user', 'conversation', 'server')),
    subject_id         UUID NOT NULL,
    report_id          UUID UNIQUE REFERENCES reports(id) ON DELETE SET NULL,
    -- The reported message, for report cases: the context window is centred on it.
    anchor_message_id  UUID,
    opened_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    justification      TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    scope_channel_ids  UUID[] NOT NULL DEFAULT '{}',
    scope_from         TIMESTAMPTZ,
    scope_to           TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ,
    closed_by          UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX cases_status_idx ON cases (status, created_at DESC);
CREATE INDEX cases_subject_idx ON cases (subject_kind, subject_id);

CREATE TABLE case_grants (
    id             UUID PRIMARY KEY,
    case_id        UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('expand', 'private_access', 'export')),
    requested_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    justification  TEXT NOT NULL,
    -- Within the case scope; empty means the whole case scope.
    channel_ids    UUID[] NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
    decided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TIMESTAMPTZ,
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Two people: nobody decides their own request.
    CONSTRAINT case_grants_two_person CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX case_grants_case_idx ON case_grants (case_id, status);

-- Open reports get their case now; new reports get one when filed.
INSERT INTO cases (id, kind, subject_kind, subject_id, report_id, anchor_message_id, justification, scope_channel_ids, expires_at, created_at)
SELECT gen_random_uuid(), 'report',
       CASE r.kind WHEN 'guild' THEN 'server' WHEN 'message' THEN 'conversation' ELSE 'user' END,
       COALESCE(CASE r.kind WHEN 'guild' THEN r.guild_id WHEN 'message' THEN r.channel_id END, r.target_user_id, r.id),
       r.id, r.message_id, 'Report: ' || left(r.reason, 400),
       CASE WHEN r.channel_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[r.channel_id] END,
       now() + interval '30 days', r.created_at
FROM reports r WHERE r.status = 'open';
