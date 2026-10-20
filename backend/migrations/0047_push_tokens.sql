-- Native app push tokens (FCM on Android; APNs tokens are relayed through FCM as well when the iOS app uses Firebase).
CREATE TABLE push_tokens (
    token      TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens(user_id);
