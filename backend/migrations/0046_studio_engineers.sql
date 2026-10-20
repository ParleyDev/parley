-- Studios may have several engineers; keep them in their own table (the single engineer_id column is retired).
CREATE TABLE studio_engineers (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
INSERT INTO studio_engineers (channel_id, user_id) SELECT id, engineer_id FROM channels WHERE engineer_id IS NOT NULL;
ALTER TABLE channels DROP COLUMN engineer_id;
