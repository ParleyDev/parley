-- Why a DM went to Spam, shown to the recipient.
ALTER TABLE channel_members ADD COLUMN spam_reasons TEXT[] NOT NULL DEFAULT '{}';
