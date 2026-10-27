-- Linked roles: a role members can claim themselves once they meet its requirements (account age, verified email,
-- a linked account, or a value an app reports about them). Apps describe what they report (metadata) and set each
-- user's values through role connections.
ALTER TABLE roles ADD COLUMN requirements JSONB;
ALTER TABLE applications ADD COLUMN role_connection_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE user_role_connections (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id            UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    platform_name     TEXT NOT NULL DEFAULT '',
    platform_username TEXT NOT NULL DEFAULT '',
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, app_id)
);
