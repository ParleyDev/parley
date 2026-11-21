-- Reports: what kind of problem (so child-safety, threats and self-harm concerns are handled first), evidence that
-- outlives the reported message and account, and a legal hold.
--
-- category: one of the fixed set in src/routes/reports.rs (older reports keep 'other'). urgent: decided by the
-- category when the report is filed; urgent reports are listed first and are not held back by the reporter's limit.
-- evidence: taken when the report is filed. For a message: the message, its attachments' details, the sender's
-- profile as it was, and, in a server channel, the messages around it (the same window a report handler may read; a
-- direct message's surroundings are not captured, they need a grant on the case). Copies of the reported message's
-- attachments are kept under UPLOAD_DIR/evidence/<report id>/ (never served) and listed in report_evidence_files.
-- Evidence is cleared REPORT_RETENTION_DAYS after a report is closed, unless the report is on legal hold.
ALTER TABLE reports
  ADD COLUMN category   TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN urgent     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN evidence   JSONB;
CREATE INDEX reports_urgent_idx ON reports (id DESC) WHERE urgent AND status = 'open';

CREATE TABLE report_evidence_files (
    report_id     UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL,
    filename      TEXT NOT NULL DEFAULT '',
    content_type  TEXT NOT NULL DEFAULT '',
    size          BIGINT NOT NULL DEFAULT 0,
    sha256        TEXT NOT NULL DEFAULT '',
    kept          BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (report_id, attachment_id)
);
