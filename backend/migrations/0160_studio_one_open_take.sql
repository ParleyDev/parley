-- One take at a time in a project. Starting one was check-then-insert, so two started at the same moment could both
-- be let through; the index decides instead. Any extra open takes left by that are ended first (the newest stays).
UPDATE studio_sessions s SET ended_at = now()
WHERE s.ended_at IS NULL AND EXISTS (SELECT 1 FROM studio_sessions n WHERE n.channel_id = s.channel_id AND n.ended_at IS NULL AND n.id > s.id);
CREATE UNIQUE INDEX studio_sessions_one_open_idx ON studio_sessions(channel_id) WHERE ended_at IS NULL;
