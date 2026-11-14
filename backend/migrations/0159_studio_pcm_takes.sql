-- Lossless takes: a take recorded as PCM says what it holds (sample rate, channels, bits per sample; all NULL for a
-- compressed take from a browser that cannot capture PCM), so the server can write its WAV header and tell its
-- length from its size. `chunk_at` is when its last piece arrived: a take that has gone quiet is finished by the
-- server. `processed` marks a take captured from the call's microphone path while its processing (echo
-- cancellation, noise suppression, gain control) was on.
ALTER TABLE studio_tracks ADD COLUMN sample_rate INT,
    ADD COLUMN channels SMALLINT,
    ADD COLUMN bits SMALLINT,
    ADD COLUMN chunk_at TIMESTAMPTZ,
    ADD COLUMN processed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX studio_tracks_open ON studio_tracks (created_at) WHERE NOT done;
