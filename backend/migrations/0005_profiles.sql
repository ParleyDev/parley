ALTER TABLE users
    ADD COLUMN banner_url    TEXT,
    ADD COLUMN theme_primary TEXT,   -- '#rrggbb' profile theme colour
    ADD COLUMN theme_accent  TEXT,   -- second colour for a gradient, NULL for solid
    ADD COLUMN pronouns      TEXT NOT NULL DEFAULT '';
