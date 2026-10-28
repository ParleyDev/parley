-- Phase 1: existing admins keep running the instance and handling reports. SUPER_ADMIN (roles, settings) has no
-- content permissions, so they also get TS_LEAD. Adjust per person afterwards in Admin › Roles.
INSERT INTO admin_roles (user_id, role) SELECT id, r FROM users, unnest(ARRAY['SUPER_ADMIN', 'TS_LEAD']) AS r WHERE is_admin AND account_state = 'active'
ON CONFLICT DO NOTHING;
