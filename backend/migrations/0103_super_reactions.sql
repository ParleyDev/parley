-- Super reactions: a reaction can be a "burst" one, counted separately (you can have both kinds of the same emoji).
ALTER TABLE reactions
  ADD COLUMN burst BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE reactions DROP CONSTRAINT reactions_pkey;
ALTER TABLE reactions ADD PRIMARY KEY (message_id, user_id, emoji, burst);
CREATE INDEX reactions_burst_user ON reactions (user_id, created_at) WHERE burst;
