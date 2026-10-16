-- Polls are messages with a question and 2..10 options; votes are per option (multi) or exclusive.
CREATE TABLE polls (
    message_id  UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    multi       BOOLEAN NOT NULL DEFAULT false,
    expires_at  TIMESTAMPTZ,
    closed_at   TIMESTAMPTZ
);
CREATE TABLE poll_options (
    id          UUID PRIMARY KEY,
    message_id  UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    position    INT NOT NULL,
    text        TEXT NOT NULL
);
CREATE INDEX poll_options_msg_idx ON poll_options (message_id, position);
CREATE TABLE poll_votes (
    message_id  UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    option_id   UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (option_id, user_id)
);
CREATE INDEX poll_votes_msg_user_idx ON poll_votes (message_id, user_id);
