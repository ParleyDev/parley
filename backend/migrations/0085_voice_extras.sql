-- Entrance sounds (a soundboard sound, yours from any server you're in or a built-in, played when you join a voice
-- channel) and a per-channel camera quality ('auto' = 720p, 'full' = 1080p).
ALTER TABLE users ADD COLUMN entrance_sound TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN video_quality TEXT NOT NULL DEFAULT 'auto';
