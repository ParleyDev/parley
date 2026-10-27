-- End-to-end encrypted calls by default: new voice, stage, DM and group channels start encrypted (Studio channels
-- don't: recording needs the server to hear the tracks). Moderators can still turn it off per channel.
CREATE FUNCTION channels_e2ee_default() RETURNS trigger AS $$
BEGIN
  NEW.e2ee := NEW.kind IN ('voice', 'stage', 'dm', 'group');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER channels_e2ee_default BEFORE INSERT ON channels FOR EACH ROW EXECUTE FUNCTION channels_e2ee_default();
-- Existing calls follow the new default (nobody had chosen otherwise: it used to start off).
UPDATE channels SET e2ee = true WHERE kind IN ('voice', 'stage', 'dm', 'group') AND NOT e2ee;
