-- Studio project permissions (perms.rs): Create Projects (bit 32), Manage Projects (33), Delete Projects (34).
-- Everyone may start a project, as anyone in a studio could before; whoever manages channels manages and deletes them.
UPDATE roles SET permissions = permissions | 4294967296 WHERE id = guild_id;
UPDATE roles SET permissions = permissions | 8589934592 | 17179869184 WHERE permissions & 16 <> 0;
