-- Browser push (Web Push with VAPID) for the installed web app and open-tab-less browsers.
CREATE TABLE web_push_subs (
    endpoint   TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The session that subscribed: signing out (or revoking it) stops this browser's pushes and their actions.
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX web_push_subs_user_idx ON web_push_subs(user_id);

-- The server's VAPID key pair (one row), made on first use.
CREATE TABLE vapid_keys (
    id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    private_pem TEXT NOT NULL,
    public_key  TEXT NOT NULL
);
