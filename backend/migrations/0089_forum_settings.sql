-- Forum settings: default layout ('gallery' or 'list') and sort ('activity' or 'created'), requiring a tag on new
-- posts, and a default reaction offered on every post. Post guidelines are the channel topic.
ALTER TABLE channels
  ADD COLUMN forum_layout TEXT NOT NULL DEFAULT 'gallery',
  ADD COLUMN forum_sort TEXT NOT NULL DEFAULT 'activity',
  ADD COLUMN forum_require_tag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN forum_default_reaction TEXT NOT NULL DEFAULT '';
