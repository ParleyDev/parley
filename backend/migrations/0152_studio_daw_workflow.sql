-- DAW phases 3-5. Projects get a tempo map (tempo and time signature changes from a bar on), a loop range (loop
-- playback, loop recording into takes, punch recording into the range) and markers. Lanes can be MIDI tracks
-- played by an instrument, and can be nudged in time. Clips are audio or MIDI notes; takes of one loop recording
-- share a group. Takes may be recorded alone (a solo take: only its starter records and hears the backing).
-- Comments pin to the timeline; versions keep snapshots of a project to go back to.
ALTER TABLE studio_projects ADD COLUMN tempo_map JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN loop_on BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN loop_start_ms INT,
    ADD COLUMN loop_end_ms INT,
    ADD COLUMN punch_on BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN markers JSONB NOT NULL DEFAULT '[]';
ALTER TABLE studio_lanes ADD COLUMN nudge_ms INT NOT NULL DEFAULT 0,
    ADD COLUMN instrument JSONB;
ALTER TABLE studio_clips ALTER COLUMN audio_id DROP NOT NULL,
    ADD COLUMN notes JSONB,
    ADD COLUMN group_id UUID;
ALTER TABLE studio_sessions ADD COLUMN loop_start_ms INT,
    ADD COLUMN loop_end_ms INT,
    ADD COLUMN punch BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN solo BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE studio_comments (
    id         UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    ms         INT NOT NULL,
    lane_id    UUID,
    body       TEXT NOT NULL,
    resolved   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX studio_comments_project_idx ON studio_comments(project_id, ms);

CREATE TABLE studio_versions (
    id         UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    data       JSONB NOT NULL
);
CREATE INDEX studio_versions_project_idx ON studio_versions(project_id, created_at DESC);
