-- MCP (Model Context Protocol): AI assistants such as Claude connect to https://<server>/mcp and act as the user who
-- approved them. OAuth 2.1 per the MCP authorization spec: clients register themselves (RFC 7591, public clients,
-- PKCE), users approve them on a consent page, and get a grant holding short-lived access tokens and rotating refresh
-- tokens. Separate from developer applications (0056), which have owners, secrets and different scopes.
CREATE TABLE mcp_clients (
    id            UUID PRIMARY KEY,
    client_id     TEXT NOT NULL UNIQUE,
    client_name   TEXT NOT NULL,
    client_uri    TEXT,
    redirect_uris TEXT[] NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ
);

-- One per user and client: what the user approved. Revoking it ends every token under it.
CREATE TABLE mcp_grants (
    id           UUID PRIMARY KEY,
    client_id    UUID NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX mcp_grants_user_idx ON mcp_grants(user_id) WHERE revoked_at IS NULL;

CREATE TABLE mcp_codes (
    code_hash      TEXT PRIMARY KEY,
    client_id      UUID NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes         TEXT[] NOT NULL,
    redirect_uri   TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    resource       TEXT,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ
);

CREATE TABLE mcp_tokens (
    token_hash TEXT PRIMARY KEY,
    grant_id   UUID NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX mcp_tokens_grant_idx ON mcp_tokens(grant_id);
