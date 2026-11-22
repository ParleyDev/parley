-- Threat feeds for the blocked-links list. A feed is the address of a list of malicious domains that someone else
-- maintains (URLhaus and the like); Parley fetches it every few hours and blocks links to what it names, next to
-- the domains an administrator added by hand (`source = ''`), which a feed never overrides or removes.
ALTER TABLE blocked_domains ADD COLUMN source TEXT NOT NULL DEFAULT '';
CREATE INDEX blocked_domains_source ON blocked_domains (source) WHERE source <> '';

CREATE TABLE link_feeds (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    entries     INT NOT NULL DEFAULT 0,
    last_run    TIMESTAMPTZ,
    last_status TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
