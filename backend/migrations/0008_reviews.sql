-- Profile reviews: one short note per author on another user's profile ("User Reviews" in the popout).
CREATE TABLE user_reviews (
    id         UUID PRIMARY KEY,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_id, author_id)
);
CREATE INDEX user_reviews_target_idx ON user_reviews(target_id, created_at DESC);
