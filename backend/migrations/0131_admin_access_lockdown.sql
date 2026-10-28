-- Phase 0 of admin access controls (docs/admin-access-and-server-deletion.md).
--
-- Admin roles. Only SUPER_ADMIN_TEMP is used yet: it alone may search message content in the admin console. Admins
-- listed in ADMIN_EMAILS hold it implicitly; anyone else needs a row here. The other roles arrive in Phase 1.
CREATE TABLE admin_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('SUPPORT', 'MODERATOR', 'TS_LEAD', 'LEGAL', 'SUPER_ADMIN', 'AUDITOR', 'SUPER_ADMIN_TEMP')),
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

-- Every admin look at content: who, as what, why, what they asked for and what they saw. IDs only (no names, so an
-- account deletion never needs to rewrite it). Append-only: the database refuses updates, deletes and truncation.
CREATE TABLE admin_access_log (
    id UUID PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id UUID NOT NULL,
    actor_roles TEXT[] NOT NULL DEFAULT '{}',
    action TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    filters JSONB NOT NULL DEFAULT '{}',
    justification TEXT NOT NULL DEFAULT '',
    target_ids UUID[] NOT NULL DEFAULT '{}',
    case_id UUID,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX admin_access_log_at ON admin_access_log (at DESC);
CREATE INDEX admin_access_log_actor ON admin_access_log (actor_id, at DESC);

CREATE FUNCTION admin_access_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin_access_log is append-only';
END $$;
CREATE TRIGGER admin_access_log_no_change BEFORE UPDATE OR DELETE ON admin_access_log FOR EACH ROW EXECUTE FUNCTION admin_access_log_append_only();
CREATE TRIGGER admin_access_log_no_truncate BEFORE TRUNCATE ON admin_access_log FOR EACH STATEMENT EXECUTE FUNCTION admin_access_log_append_only();
