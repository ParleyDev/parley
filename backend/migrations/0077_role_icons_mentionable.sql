-- Role icons (an emoji, or an uploaded image) shown next to members' names, and whether anyone may @mention the
-- role. Existing roles stay mentionable so nothing changes for them; new roles start unmentionable, as in Discord.
ALTER TABLE roles ADD COLUMN icon TEXT, ADD COLUMN mentionable BOOLEAN NOT NULL DEFAULT false;
UPDATE roles SET mentionable = true;
