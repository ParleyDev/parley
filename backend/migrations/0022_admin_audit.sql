-- Who did what in the admin console. Actor/target rows may be deleted later, so names are copied in.
CREATE TABLE admin_audit (
    id           UUID PRIMARY KEY,
    actor_id     UUID,
    actor_name   TEXT NOT NULL,
    action       TEXT NOT NULL,          -- user.promote, user.suspend, guild.delete, settings.update, discovery.review, ...
    target_kind  TEXT NOT NULL DEFAULT '', -- user | guild | settings | ''
    target_id    UUID,
    target_name  TEXT NOT NULL DEFAULT '',
    details      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC);
