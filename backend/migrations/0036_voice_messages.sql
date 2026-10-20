-- Voice messages: audio attachments recorded in the app carry their length and a tiny waveform for the player.
ALTER TABLE attachments ADD COLUMN duration_ms INT;
ALTER TABLE attachments ADD COLUMN waveform TEXT;   -- base64 of up to 128 amplitude bytes (0..255)
