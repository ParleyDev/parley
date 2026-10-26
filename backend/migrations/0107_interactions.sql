-- Bot platform: privileged gateway intents an app has switched on, application commands (slash, user, message), and
-- interactions (a command invoked by someone, answered by the app's bot). Responses that are not ephemeral are
-- ordinary messages carrying who used which command.
ALTER TABLE applications ADD COLUMN privileged_intents INT NOT NULL DEFAULT 0;
CREATE TABLE application_commands (
    id             UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    guild_id       UUID REFERENCES guilds(id) ON DELETE CASCADE,
    kind           SMALLINT NOT NULL DEFAULT 1 CHECK (kind IN (1, 2, 3)),
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    options        JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX application_commands_unique ON application_commands (application_id, COALESCE(guild_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name);
CREATE TABLE interactions (
    id             UUID PRIMARY KEY,
    token_hash     TEXT NOT NULL,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    guild_id       UUID,
    kind           SMALLINT NOT NULL,
    data           JSONB NOT NULL,
    -- The first response: the message it made (or, for an ephemeral one, its content), and when.
    message_id     UUID,
    ephemeral      JSONB,
    responded_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interactions_created ON interactions (created_at);
ALTER TABLE messages ADD COLUMN interaction JSONB;
