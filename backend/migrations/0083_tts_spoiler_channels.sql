-- /tts messages (read aloud to people viewing the channel) with Discord's Send TTS Messages permission (1 << 12,
-- given to @everyone like Discord's defaults), and spoiler channels (a warning before you see them; media blurred).
ALTER TABLE messages ADD COLUMN tts BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN spoiler BOOLEAN NOT NULL DEFAULT false;
UPDATE roles SET permissions = permissions | 4096 WHERE id = guild_id;
