-- Recording onto a chosen track: a member's takes land on the lane they most recently made theirs ("record here").
ALTER TABLE studio_lanes ADD COLUMN claimed_at TIMESTAMPTZ;
