-- Poll answers can carry an emoji; bookmarks can carry a reminder ("Remind me in 1 hour"), delivered once.
ALTER TABLE poll_options ADD COLUMN emoji TEXT;
ALTER TABLE bookmarks ADD COLUMN remind_at TIMESTAMPTZ, ADD COLUMN reminded BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX bookmarks_due ON bookmarks (remind_at) WHERE remind_at IS NOT NULL AND NOT reminded;
