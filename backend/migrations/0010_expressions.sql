-- Uploaded profile/server images (avatars, banners, icons) plus custom emoji and stickers.
-- Files live under UPLOAD_DIR/<id> like attachments and are served at /api/images/<id>.
CREATE TABLE images (
    id           UUID PRIMARY KEY,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,              -- avatar | banner | icon | emoji | sticker
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL,
    width        INT,
    height       INT,
    animated     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX images_kind_created_idx ON images(kind, created_at);

-- A custom emoji shares its id with the image that backs it, so `<:name:id>` resolves to
-- /api/images/<id> without a lookup.
CREATE TABLE emojis (
    id         UUID PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    animated   BOOLEAN NOT NULL DEFAULT false,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, name)
);
CREATE INDEX emojis_guild_idx ON emojis(guild_id);

CREATE TABLE stickers (
    id          UUID PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
    guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    animated    BOOLEAN NOT NULL DEFAULT false,
    creator_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, name)
);
CREATE INDEX stickers_guild_idx ON stickers(guild_id);

ALTER TABLE messages ADD COLUMN sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;
