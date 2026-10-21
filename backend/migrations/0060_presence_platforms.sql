-- Per-platform socket counts for presence (web / desktop / mobile / vr), so clients can show where someone is online.
ALTER TABLE presence ADD COLUMN platforms JSONB NOT NULL DEFAULT '{}'::jsonb;
