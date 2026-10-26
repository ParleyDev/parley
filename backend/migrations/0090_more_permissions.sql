-- More of Discord's permission bits: View Audit Log (1<<7), Embed Links (1<<14), Read Message History (1<<16),
-- Use External Emoji (1<<18), Manage Threads (1<<19), Manage Events (1<<25), Manage Expressions (1<<30).
-- @everyone keeps today's behaviour: it gets Embed Links, Read Message History and Use External Emoji.
UPDATE roles SET permissions = permissions | 16384 | 65536 | 262144 WHERE id = guild_id;
