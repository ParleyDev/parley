-- Settings → Content & Social: who may DM you, message requests from non-friends, who may send friend
-- requests, who may add you to groups. A DM membership can be a pending message request.
ALTER TABLE users ADD COLUMN dm_privacy TEXT NOT NULL DEFAULT 'everyone' CHECK (dm_privacy IN ('everyone', 'friends_and_servers', 'friends'));
ALTER TABLE users ADD COLUMN message_requests BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN friend_request_from TEXT[] NOT NULL DEFAULT '{everyone}';
ALTER TABLE users ADD COLUMN group_dm_privacy TEXT NOT NULL DEFAULT 'friends' CHECK (group_dm_privacy IN ('friends', 'nobody'));
ALTER TABLE channel_members ADD COLUMN request_state TEXT NOT NULL DEFAULT 'accepted' CHECK (request_state IN ('accepted', 'pending', 'ignored'));
