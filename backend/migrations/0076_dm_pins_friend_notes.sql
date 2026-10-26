-- Closing a DM hides it from your list until a new message arrives; pinned channels and DMs (per account, in
-- order) sit at the top of their lists; friend requests can carry a short note.
ALTER TABLE channel_members ADD COLUMN closed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN pinned_channels UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE relationships ADD COLUMN note TEXT;
