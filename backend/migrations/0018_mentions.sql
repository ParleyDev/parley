-- Mentions parsed from message content: <@user>, <@&role>, @everyone / @here.
ALTER TABLE messages ADD COLUMN mentions UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN mention_roles UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN mention_everyone BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX messages_mentions_idx ON messages USING GIN (mentions);
-- New "Mention @everyone" permission (bit 17), on by default like Discord.
UPDATE roles SET permissions = permissions | 131072 WHERE id = guild_id;
