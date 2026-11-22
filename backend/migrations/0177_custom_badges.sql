-- Custom profile badges: an instance's admins make a badge (a name, an explanation, an emoji or a small uploaded
-- picture, a colour) and give it to people, for things that are rare and mean something on that instance. They show
-- on profiles after the built-in ones (admin, founder, veteran, guest, houses).
CREATE TABLE custom_badges (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT '',
    icon_url    TEXT,
    color       TEXT NOT NULL DEFAULT '#a78bfa',
    position    INT NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_badges (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id   UUID NOT NULL REFERENCES custom_badges(id) ON DELETE CASCADE,
    awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    note       TEXT NOT NULL DEFAULT '',
    awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX user_badges_badge ON user_badges (badge_id, awarded_at);
