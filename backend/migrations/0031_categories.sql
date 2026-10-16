-- Channel categories: a channel of kind 'category' that text/voice channels sit under (parent_id).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'dm', 'group', 'category'));
ALTER TABLE channels ADD COLUMN parent_id UUID REFERENCES channels(id) ON DELETE SET NULL;
CREATE INDEX channels_parent_idx ON channels (parent_id);
