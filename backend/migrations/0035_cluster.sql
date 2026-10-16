-- Running several backend instances: shared presence and an outbox for oversized bus payloads.
CREATE TABLE presence (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL,
    sockets     INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, instance_id)
);
CREATE INDEX presence_user_idx ON presence (user_id, updated_at);
CREATE TABLE bus_outbox (
    id         UUID PRIMARY KEY,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
