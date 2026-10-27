-- User-installable apps (their commands work for you anywhere) and the App Directory (listed public apps, with the
-- scopes and permissions they ask for when added).
CREATE TABLE user_app_installs (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id     UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, app_id)
);
ALTER TABLE applications
  ADD COLUMN listed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN install_permissions BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
