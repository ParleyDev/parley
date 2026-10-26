-- Announcement channels (text channels whose posts can be published to channels in other servers that follow them)
-- and media channels (forums whose posts lead with an image or video, shown as a gallery).
ALTER TABLE channels
  ADD COLUMN news BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN media BOOLEAN NOT NULL DEFAULT false;
-- On a published original: {"published": true}. On a copy in a follower: where it came from.
ALTER TABLE messages ADD COLUMN crosspost JSONB;
CREATE TABLE channel_follows (
    source_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, target_id)
);
CREATE INDEX channel_follows_target ON channel_follows (target_id);
