-- Thread extras: private threads (only members and moderators see them), locked threads (only moderators post),
-- auto-archive after inactivity, and thread membership (joined threads show in your channel list and notify you).
ALTER TABLE threads
  ADD COLUMN private BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_archive_minutes INT NOT NULL DEFAULT 4320;
CREATE TABLE thread_members (
    thread_id  UUID NOT NULL REFERENCES threads(channel_id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX thread_members_user_idx ON thread_members (user_id);
INSERT INTO thread_members (thread_id, user_id) SELECT channel_id, owner_id FROM threads WHERE owner_id IS NOT NULL ON CONFLICT DO NOTHING;
