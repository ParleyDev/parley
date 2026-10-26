-- Joins and leaves over time, for Server Insights. Kept by a trigger so every way in or out is counted. No foreign
-- key: a deleted server's rows are skipped (and its members' cascade deletes write nothing).
CREATE TABLE guild_member_log (
    guild_id UUID NOT NULL,
    user_id  UUID NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('join', 'leave')),
    via      TEXT,
    at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_member_log_guild_at ON guild_member_log (guild_id, at);

CREATE FUNCTION log_guild_member() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO guild_member_log (guild_id, user_id, kind, via) VALUES (NEW.guild_id, NEW.user_id, 'join', NEW.joined_via);
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM guilds WHERE id = OLD.guild_id) THEN
    INSERT INTO guild_member_log (guild_id, user_id, kind) VALUES (OLD.guild_id, OLD.user_id, 'leave');
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER guild_members_log AFTER INSERT OR DELETE ON guild_members FOR EACH ROW EXECUTE FUNCTION log_guild_member();

-- Seed history from current members so existing servers have a starting point.
INSERT INTO guild_member_log (guild_id, user_id, kind, via, at) SELECT guild_id, user_id, 'join', joined_via, joined_at FROM guild_members;
