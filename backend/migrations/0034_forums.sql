-- Forum channels: every post is a thread under a channel of kind 'forum'; posts carry tags and can be pinned.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'dm', 'group', 'category', 'thread', 'forum'));
ALTER TABLE threads ADD COLUMN pinned_at TIMESTAMPTZ;
CREATE TABLE forum_tags (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL DEFAULT '',
    position    INT NOT NULL DEFAULT 0
);
CREATE INDEX forum_tags_channel_idx ON forum_tags (channel_id, position);
CREATE TABLE thread_tags (
    thread_id   UUID NOT NULL REFERENCES threads(channel_id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES forum_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, tag_id)
);
