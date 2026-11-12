-- Track I/O, like a desktop DAW's: where a track records from (its owner's input device, by name, and channel),
-- whether its owner hears that input through it (monitor: in, auto = while armed, off), whether it is armed, and
-- whether it plays only through its sends. Takes remember the track they were recorded for.
ALTER TABLE studio_lanes ADD COLUMN input JSONB,
    ADD COLUMN monitor TEXT NOT NULL DEFAULT 'off' CHECK (monitor IN ('in', 'auto', 'off')),
    ADD COLUMN armed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN sends_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE studio_tracks ADD COLUMN lane_id UUID REFERENCES studio_lanes(id) ON DELETE SET NULL;
-- Members' tracks were armed unless the console had disarmed them.
UPDATE studio_lanes l SET armed = true
FROM studio_projects p LEFT JOIN studio_config c ON c.channel_id = p.channel_id
WHERE l.project_id = p.id AND l.kind = 'audio' AND l.user_id IS NOT NULL AND NOT (l.user_id = ANY(COALESCE(c.disarmed, '{}')));
