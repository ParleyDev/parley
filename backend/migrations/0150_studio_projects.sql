-- The studio as a DAW: a studio has projects (songs), one of them open at a time for everyone in it. A project has
-- lanes (tracks in the mixer) holding clips, each a window onto an audio file placed on the timeline. Audio files are
-- the takes recorded in the studio and files imported into it, both kept in studio_tracks (an import has no session).
-- Everyone in the band edits the open project at once: every change is an op the server applies and broadcasts.
CREATE TABLE studio_projects (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    bpm         INT NOT NULL DEFAULT 120,
    beats       INT NOT NULL DEFAULT 4,
    master_gain REAL NOT NULL DEFAULT 1,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX studio_projects_channel_idx ON studio_projects(channel_id, updated_at DESC);
ALTER TABLE studio_config ADD COLUMN project_id UUID REFERENCES studio_projects(id) ON DELETE SET NULL;

CREATE TABLE studio_lanes (
    id         UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    position   REAL NOT NULL DEFAULT 0,
    gain       REAL NOT NULL DEFAULT 1,
    pan        REAL NOT NULL DEFAULT 0,
    mute       BOOLEAN NOT NULL DEFAULT false,
    solo       BOOLEAN NOT NULL DEFAULT false,
    -- Whose recordings land on this lane.
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX studio_lanes_project_idx ON studio_lanes(project_id);

ALTER TABLE studio_tracks ALTER COLUMN session_id DROP NOT NULL,
    ADD COLUMN channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    ADD COLUMN name TEXT,
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'take',
    -- Output plus input latency measured by the recording client, already taken off offset_ms.
    ADD COLUMN latency_ms INT NOT NULL DEFAULT 0;
UPDATE studio_tracks t SET channel_id = s.channel_id FROM studio_sessions s WHERE s.id = t.session_id;

CREATE TABLE studio_clips (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    lane_id     UUID NOT NULL REFERENCES studio_lanes(id) ON DELETE CASCADE,
    audio_id    UUID NOT NULL REFERENCES studio_tracks(id) ON DELETE CASCADE,
    -- Where it sits on the timeline (0 = bar 1), where in the audio it starts, and how long it plays.
    start_ms    INT NOT NULL,
    in_ms       INT NOT NULL DEFAULT 0,
    length_ms   INT NOT NULL,
    gain        REAL NOT NULL DEFAULT 1,
    fade_in_ms  INT NOT NULL DEFAULT 0,
    fade_out_ms INT NOT NULL DEFAULT 0,
    muted       BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX studio_clips_project_idx ON studio_clips(project_id);

-- A take recorded into a project: where on the timeline its downbeat was.
ALTER TABLE studio_sessions ADD COLUMN project_id UUID REFERENCES studio_projects(id) ON DELETE SET NULL,
    ADD COLUMN position_ms INT NOT NULL DEFAULT 0;
