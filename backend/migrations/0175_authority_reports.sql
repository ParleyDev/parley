-- The record that a report to the authorities (NCMEC's CyberTipline, a national hotline, the police) was dealt
-- with: either filed, with where, the reference given and when, or judged not to need one, with the reason.
-- A report about child sexual content or an adult pursuing a child cannot be closed without one.
CREATE TABLE authority_reports (
    id                 UUID PRIMARY KEY,
    subject_kind       TEXT NOT NULL CHECK (subject_kind IN ('report', 'match')),
    subject_id         UUID NOT NULL,
    decision           TEXT NOT NULL CHECK (decision IN ('filed', 'not_required')),
    authority          TEXT NOT NULL DEFAULT '',
    reference          TEXT NOT NULL DEFAULT '',
    filed_at           TIMESTAMPTZ,
    evidence_preserved BOOLEAN NOT NULL DEFAULT false,
    note               TEXT NOT NULL DEFAULT '',
    recorded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_id)
);
