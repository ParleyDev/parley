-- Direct messages from friends and people you share a server with, unless you choose otherwise. Accounts still on
-- "everyone" move to the new default (the schema never recorded whether that was a choice); Content & Social lets
-- anyone switch back.
ALTER TABLE users ALTER COLUMN dm_privacy SET DEFAULT 'friends_and_servers';
UPDATE users SET dm_privacy = 'friends_and_servers' WHERE dm_privacy = 'everyone';
