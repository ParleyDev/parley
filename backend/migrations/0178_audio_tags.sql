-- Music files' tags (title, artist, album, year, track, genre) for the players; NULL until read, {} when there are none.
ALTER TABLE attachments ADD COLUMN audio_tags JSONB;
