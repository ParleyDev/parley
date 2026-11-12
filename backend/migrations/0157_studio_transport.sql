-- Shared playback: a project's transport, followed by everyone in it. Playing from `play_from_ms` on the timeline
-- since `play_at` (server time); stopped when `play_at` is null (`play_from_ms` is then where it stopped).
ALTER TABLE studio_projects ADD COLUMN play_from_ms INT NOT NULL DEFAULT 0,
    ADD COLUMN play_at TIMESTAMPTZ,
    ADD COLUMN play_by UUID;
