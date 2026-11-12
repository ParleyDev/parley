-- Studio projects become their own channels. A studio channel is now a list of projects, like a forum of posts;
-- each project is a channel of kind 'project' under it (parent_id) with its own chat, voice room, console settings,
-- band and audio, so everything about a song lives in one place and goes with it when it is deleted.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'stage', 'studio', 'project', 'dm', 'group', 'category', 'thread', 'forum', 'directory'));

-- The band of a project: engineers run it (record the band, manage the band, rename it), artists edit and record.
ALTER TABLE studio_engineers ADD COLUMN role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('engineer', 'artist'));

-- A project's place in its studio's list: a stage tag, archiving, and when anything last happened in it.
ALTER TABLE studio_projects ADD COLUMN tag TEXT NOT NULL DEFAULT '',
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN room UUID;

-- Sessions recorded outside any project become projects of their own, named after the session.
INSERT INTO studio_projects (id, channel_id, name, bpm, beats, created_by, created_at, updated_at)
SELECT gen_random_uuid(), s.channel_id, s.name, s.bpm, s.beats, s.started_by, s.started_at, COALESCE(s.ended_at, s.started_at)
FROM studio_sessions s
WHERE s.project_id IS NULL AND EXISTS (SELECT 1 FROM studio_tracks t WHERE t.session_id = s.id AND t.done AND t.duration_ms > 0);
UPDATE studio_sessions s SET project_id = p.id
FROM studio_projects p
WHERE s.project_id IS NULL AND p.channel_id = s.channel_id AND p.name = s.name AND p.created_at = s.started_at AND p.room IS NULL
  AND NOT EXISTS (SELECT 1 FROM studio_lanes l WHERE l.project_id = p.id);
-- One lane per member who recorded, their takes as clips where they were recorded.
INSERT INTO studio_lanes (id, project_id, name, position, user_id)
SELECT gen_random_uuid(), x.project_id, x.name, x.n - 1, x.user_id
FROM (
    SELECT s.project_id, t.user_id, COALESCE(MIN(u.display_name), MIN(u.username), 'Track') AS name, ROW_NUMBER() OVER (PARTITION BY s.project_id ORDER BY MIN(t.created_at)) AS n
    FROM studio_sessions s JOIN studio_tracks t ON t.session_id = s.id LEFT JOIN users u ON u.id = t.user_id
    WHERE t.done AND t.duration_ms > 0 AND NOT EXISTS (SELECT 1 FROM studio_lanes l WHERE l.project_id = s.project_id)
    GROUP BY s.project_id, t.user_id
) x;
INSERT INTO studio_clips (id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, created_by)
SELECT gen_random_uuid(), s.project_id, l.id, t.id, GREATEST(t.offset_ms, 0), GREATEST(-t.offset_ms, 0), t.duration_ms - GREATEST(-t.offset_ms, 0), t.user_id
FROM studio_sessions s JOIN studio_tracks t ON t.session_id = s.id
JOIN studio_lanes l ON l.project_id = s.project_id AND l.user_id IS NOT DISTINCT FROM t.user_id
WHERE t.done AND t.duration_ms > GREATEST(-t.offset_ms, 0)
  AND NOT EXISTS (SELECT 1 FROM studio_clips c WHERE c.audio_id = t.id);

-- A channel for every project, under its studio.
UPDATE studio_projects SET room = gen_random_uuid();
INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id, audio_mode, audio_low_latency)
SELECT p.room, s.guild_id, LEFT(p.name, 100), 'project', '', (ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY p.created_at))::int - 1, s.id, 'music', true
FROM studio_projects p JOIN channels s ON s.id = p.channel_id;

-- Each project keeps its studio's console settings and engineers, and its creator runs it.
INSERT INTO studio_config (channel_id, bpm, beats, click, count_in, project_id)
SELECT p.room, p.bpm, p.beats, COALESCE(c.click, true), COALESCE(c.count_in, 1), p.id
FROM studio_projects p LEFT JOIN studio_config c ON c.channel_id = p.channel_id;
INSERT INTO studio_engineers (channel_id, user_id, role)
SELECT p.room, e.user_id, 'engineer' FROM studio_projects p JOIN studio_engineers e ON e.channel_id = p.channel_id
ON CONFLICT DO NOTHING;
INSERT INTO studio_engineers (channel_id, user_id, role)
SELECT p.room, p.created_by, 'engineer' FROM studio_projects p WHERE p.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- Takes move with their session into the project; imports go to the first project that uses them (or the studio's
-- newest project when none does yet).
UPDATE studio_sessions s SET channel_id = p.room FROM studio_projects p WHERE s.project_id = p.id;
UPDATE studio_tracks t SET channel_id = s.channel_id FROM studio_sessions s WHERE t.session_id = s.id;
UPDATE studio_tracks t SET channel_id = (
    SELECT p.room FROM studio_clips c JOIN studio_projects p ON p.id = c.project_id WHERE c.audio_id = t.id ORDER BY c.created_at LIMIT 1
) WHERE t.session_id IS NULL AND EXISTS (SELECT 1 FROM studio_clips c WHERE c.audio_id = t.id);
UPDATE studio_tracks t SET channel_id = (
    SELECT p.room FROM studio_projects p WHERE p.channel_id = t.channel_id ORDER BY p.updated_at DESC LIMIT 1
) WHERE t.session_id IS NULL AND EXISTS (SELECT 1 FROM studio_projects p WHERE p.channel_id = t.channel_id);

UPDATE studio_projects SET channel_id = room;
ALTER TABLE studio_projects DROP COLUMN room;
CREATE UNIQUE INDEX studio_projects_room_idx ON studio_projects(channel_id);

-- The studio itself no longer has a console, an open project or engineers of its own.
DELETE FROM studio_config WHERE channel_id IN (SELECT id FROM channels WHERE kind = 'studio');
DELETE FROM studio_engineers WHERE channel_id IN (SELECT id FROM channels WHERE kind = 'studio');
