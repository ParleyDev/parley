-- A community's page: a banner, a longer about text and a short list of links.
ALTER TABLE communities
    ADD COLUMN banner_url TEXT,
    ADD COLUMN about      TEXT  NOT NULL DEFAULT '',
    ADD COLUMN links      JSONB NOT NULL DEFAULT '[]';
