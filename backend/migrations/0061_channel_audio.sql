-- Per-channel audio profile for voice, stage and studio channels.
--   audio_mode         'voice' (speech: processing on, mono, DTX) | 'music' (high fidelity: stereo, no processing, no DTX)
--   audio_bitrate      Opus bitrate in kbps (8..510); 0 = the mode's default (voice 64, music 256)
--   audio_low_latency  10 ms Opus frames and the smallest jitter buffer the browser allows
ALTER TABLE channels
    ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'voice' CHECK (audio_mode IN ('voice', 'music')),
    ADD COLUMN audio_bitrate INT NOT NULL DEFAULT 0 CHECK (audio_bitrate = 0 OR audio_bitrate BETWEEN 8 AND 510),
    ADD COLUMN audio_low_latency BOOLEAN NOT NULL DEFAULT false;

-- Studios are for music: high fidelity, low latency.
UPDATE channels SET audio_mode = 'music', audio_low_latency = true WHERE kind = 'studio';
