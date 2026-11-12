-- DAW phase 2: effects, buses and automation. A lane is an audio track or a bus (a return track the others send to);
-- each has a chain of insert effects, sends to buses, an output (a bus, or the master) and automation (breakpoints
-- per parameter: volume, pan, send levels and effect parameters). The project has a master effect chain.
ALTER TABLE studio_lanes ADD COLUMN kind TEXT NOT NULL DEFAULT 'audio',
    ADD COLUMN effects JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN sends JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN automation JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN output_id UUID;
ALTER TABLE studio_projects ADD COLUMN master_effects JSONB NOT NULL DEFAULT '[]';
