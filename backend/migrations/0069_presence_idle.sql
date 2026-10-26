-- Automatic idle: how many of this row's sockets report their user as away (no input for a while, or a mobile app in
-- the background). A user whose every socket is idle shows as Idle unless they picked a status themselves.
ALTER TABLE presence ADD COLUMN idle INT NOT NULL DEFAULT 0;
