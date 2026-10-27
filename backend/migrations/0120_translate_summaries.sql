-- Message translations (cached per message, language and content) and the per-server AI summaries switch.
CREATE TABLE message_translations (
    message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    lang         TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_lang  TEXT NOT NULL DEFAULT '',
    text         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, lang)
);
ALTER TABLE guilds ADD COLUMN summaries_enabled BOOLEAN NOT NULL DEFAULT true;
