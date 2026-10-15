-- Group DMs: a 'group' channel has an owner, an optional custom icon, and 3..10 members.
ALTER TABLE channels ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE channels ADD COLUMN icon_url TEXT;
ALTER TABLE channel_members ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT now();
