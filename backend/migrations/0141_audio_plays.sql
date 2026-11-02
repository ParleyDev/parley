-- Listen counts on audio files: every play (30 s of listening, or half a shorter track, from the start) adds one;
-- attachment_listens doubles as the list of who has listened, with when they last counted a play.
ALTER TABLE attachments ADD COLUMN plays INT NOT NULL DEFAULT 0;
ALTER TABLE attachment_listens ADD COLUMN last_played_at TIMESTAMPTZ NOT NULL DEFAULT now();
