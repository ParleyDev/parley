-- Phase 3 (docs/admin-access-and-server-deletion.md): global admin message search is gone, and with it the temporary
-- role that guarded it. Content is reached through cases and the public-server search; the access log keeps every
-- entry ever written with SUPER_ADMIN_TEMP in its roles.
DELETE FROM admin_roles WHERE role = 'SUPER_ADMIN_TEMP';
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_role_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_role_check CHECK (role IN ('SUPPORT', 'MODERATOR', 'TS_LEAD', 'LEGAL', 'SUPER_ADMIN', 'AUDITOR'));
