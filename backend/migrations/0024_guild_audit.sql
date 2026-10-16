-- Per-server audit log (Server Settings -> Audit Log): moderation and settings changes with actor/target names copied in.
CREATE TABLE guild_audit (
    id           UUID PRIMARY KEY,
    guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_id     UUID,
    actor_name   TEXT NOT NULL,
    action       TEXT NOT NULL,
    target_kind  TEXT NOT NULL DEFAULT '',
    target_id    UUID,
    target_name  TEXT NOT NULL DEFAULT '',
    details      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_audit_guild_idx ON guild_audit (guild_id, id DESC);
