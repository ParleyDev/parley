-- Studio console, shared by every engineer of a studio: tempo and metronome, count-in, and who is disarmed (stored as
-- the disarmed so a newcomer to the band is armed). Takes keep a snapshot of the tempo they were recorded at, and
-- started_at becomes the downbeat after the count-in.
CREATE TABLE studio_config (
    channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    bpm        INT NOT NULL DEFAULT 120,
    beats      INT NOT NULL DEFAULT 4,
    click      BOOLEAN NOT NULL DEFAULT false,
    count_in   INT NOT NULL DEFAULT 0,
    disarmed   UUID[] NOT NULL DEFAULT '{}'
);
ALTER TABLE studio_sessions ADD COLUMN bpm INT NOT NULL DEFAULT 120, ADD COLUMN beats INT NOT NULL DEFAULT 4,
    ADD COLUMN click BOOLEAN NOT NULL DEFAULT false, ADD COLUMN count_in_ms INT NOT NULL DEFAULT 0;
