-- Phase 4 (docs/admin-access-and-server-deletion.md): one audit log for the admin console. Every console action now goes
-- to the append-only admin_access_log, IDs only; names are resolved when the log is read, so an account deletion
-- never rewrites history (a deleted user simply reads as deleted_user_*).
ALTER TABLE admin_access_log ADD COLUMN target_kind TEXT NOT NULL DEFAULT '';
CREATE INDEX admin_access_log_case ON admin_access_log (case_id, at DESC) WHERE case_id IS NOT NULL;
CREATE INDEX admin_access_log_targets ON admin_access_log USING GIN (target_ids);

-- The old admin_audit rows move over. Server and settings names are kept as a label, since a deleted server can't be
-- looked up; user names are not copied (they resolve from the account, tombstone included).
INSERT INTO admin_access_log (id, at, actor_id, action, filters, target_ids, target_kind)
SELECT a.id, a.created_at, COALESCE(a.actor_id, '00000000-0000-0000-0000-000000000000'), a.action,
       CASE WHEN a.target_kind <> 'user' AND a.target_name <> '' THEN a.details || jsonb_build_object('target_label', a.target_name) ELSE a.details END,
       CASE WHEN a.target_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[a.target_id] END, a.target_kind
FROM admin_audit a
ON CONFLICT (id) DO NOTHING;
DROP TABLE admin_audit;

-- Retention: only admin_access_log_prune() deletes, and the trigger lets it remove nothing younger than a year,
-- whatever retention it is asked for. UPDATE and TRUNCATE stay refused.
CREATE OR REPLACE FUNCTION admin_access_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('parley.audit_prune', true) = 'on' AND OLD.at < now() - interval '365 days' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'admin_access_log is append-only';
END $$;

CREATE FUNCTION admin_access_log_prune(retention_days int) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    IF retention_days < 365 THEN RAISE EXCEPTION 'audit retention must be at least 365 days'; END IF;
    PERFORM set_config('parley.audit_prune', 'on', true);
    DELETE FROM admin_access_log WHERE at < now() - make_interval(days => retention_days);
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('parley.audit_prune', 'off', true);
    RETURN n;
END $$;
