-- Age-restricted channels, the sensitive-media preference, and the DM spam filter (a spam request state).
ALTER TABLE channels ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN sensitive_media JSONB NOT NULL DEFAULT '{}'::jsonb;   -- {non_friend_dms: show|blur, restricted: show|blur}
ALTER TABLE users ADD COLUMN spam_filter TEXT NOT NULL DEFAULT 'non_friends' CHECK (spam_filter IN ('none', 'non_friends', 'all'));
ALTER TABLE channel_members DROP CONSTRAINT channel_members_request_state_check;
ALTER TABLE channel_members ADD CONSTRAINT channel_members_request_state_check CHECK (request_state IN ('accepted', 'pending', 'ignored', 'spam'));
