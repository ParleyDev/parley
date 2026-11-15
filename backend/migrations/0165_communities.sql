-- Communities: a named group of channels inside one server. A community is identity data (slug, name, icon, description,
-- an optional external reference) pointing at one ordinary category; channels under that category are its channels and
-- access is plain server permissions.
CREATE TABLE communities (
    id               UUID PRIMARY KEY,
    guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    slug             TEXT NOT NULL,
    name             TEXT NOT NULL,
    icon_url         TEXT,
    description      TEXT NOT NULL DEFAULT '',
    external_ref     TEXT,
    category_id      UUID NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
    last_activity_at TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, slug)
);
CREATE UNIQUE INDEX communities_external_ref_idx ON communities (guild_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE community_follows (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_follows_user_idx ON community_follows (user_id);

-- Leaving (or being removed from) a server drops that member's follows of its communities.
CREATE FUNCTION drop_community_follows() RETURNS trigger AS $$
BEGIN
  DELETE FROM community_follows WHERE user_id = OLD.user_id AND community_id IN (SELECT id FROM communities WHERE guild_id = OLD.guild_id);
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER guild_members_drop_community_follows AFTER DELETE ON guild_members FOR EACH ROW EXECUTE FUNCTION drop_community_follows();
