-- Age assurance. Restricted channels and servers open only on a record that the account holder meets the age;
-- every other account gets the protective settings. No date of birth is kept: an existing one is turned into
-- "said they are under 18" or a self-declared record, its month and day are kept, and the year is discarded.

CREATE TABLE age_assurances (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    threshold   SMALLINT NOT NULL CHECK (threshold BETWEEN 13 AND 21),
    level       TEXT NOT NULL CHECK (level IN ('declared', 'attested', 'verified')),
    provider    TEXT NOT NULL,                      -- 'self' | 'operator' | the name of a configured provider
    reference   TEXT,                               -- the provider's opaque id for the check; never a document or a date
    note        TEXT NOT NULL DEFAULT '',           -- operator attestation: how it was confirmed
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_why TEXT NOT NULL DEFAULT ''
);
CREATE INDEX age_assurances_user ON age_assurances (user_id) WHERE revoked_at IS NULL;
-- One provider result opens one account.
CREATE UNIQUE INDEX age_assurances_reference ON age_assurances (provider, reference) WHERE revoked_at IS NULL AND reference IS NOT NULL;

-- A member asking the instance's staff to confirm their age.
CREATE TABLE age_requests (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    threshold  SMALLINT NOT NULL DEFAULT 18,
    note       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    reply      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX age_requests_one_pending ON age_requests (user_id) WHERE status = 'pending';

-- A check in progress with an outside provider: single use, short lived, tied to the account and the threshold.
CREATE TABLE age_verifications (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    threshold  SMALLINT NOT NULL,
    provider   TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ
);

ALTER TABLE users
    ADD COLUMN declared_minor BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN birthday_month SMALLINT CHECK (birthday_month BETWEEN 1 AND 12),
    ADD COLUMN birthday_day   SMALLINT CHECK (birthday_day BETWEEN 1 AND 31);

UPDATE users SET birthday_month = EXTRACT(MONTH FROM birthdate), birthday_day = EXTRACT(DAY FROM birthdate),
                 declared_minor = birthdate > (now() - interval '18 years')::date
 WHERE birthdate IS NOT NULL;
INSERT INTO age_assurances (id, user_id, threshold, level, provider, note)
SELECT gen_random_uuid(), id, 18, 'declared', 'self', 'From the birth date on file before age assurance'
  FROM users WHERE birthdate IS NOT NULL AND birthdate <= (now() - interval '18 years')::date;
ALTER TABLE users DROP COLUMN birthdate;

-- An instance that already has members keeps accepting what they declared until its operator asks for proof.
-- A new instance has no row and starts at 'attested' (the default in `age_accept_level()`).
INSERT INTO instance_settings (key, value)
SELECT 'age_accept_level', '"declared"'::jsonb WHERE EXISTS (SELECT 1 FROM users WHERE NOT bot AND NOT system AND NOT guest)
ON CONFLICT (key) DO NOTHING;

-- Minimum age on a channel (a category or a forum passes it down) and on a whole server.
ALTER TABLE channels ADD COLUMN min_age SMALLINT CHECK (min_age BETWEEN 13 AND 21);
UPDATE channels SET min_age = 18 WHERE nsfw;
ALTER TABLE channels DROP COLUMN nsfw;
-- Kept under its old name for clients and bots that read it: the channel's own setting, without inheritance.
ALTER TABLE channels ADD COLUMN nsfw BOOLEAN GENERATED ALWAYS AS (min_age IS NOT NULL) STORED;
ALTER TABLE guilds ADD COLUMN min_age SMALLINT CHECK (min_age BETWEEN 13 AND 21);

CREATE FUNCTION age_level_rank(l TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE l WHEN 'declared' THEN 1 WHEN 'attested' THEN 2 WHEN 'verified' THEN 3 ELSE 9 END
$$;

CREATE FUNCTION age_accept_level() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT value #>> '{}' FROM instance_settings WHERE key = 'age_accept_level'), 'attested')
$$;

-- The one place that decides whether an account meets an age. A bot takes its owner's answer; guests, webhook
-- users and people who said they are under 18 never do.
CREATE FUNCTION age_meets(uid UUID, need INT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE u RECORD; owner UUID;
BEGIN
    IF need IS NULL THEN RETURN true; END IF;
    SELECT bot, guest, webhook, system, declared_minor INTO u FROM users WHERE id = uid;
    IF NOT FOUND THEN RETURN false; END IF;
    IF u.system THEN RETURN true; END IF;
    IF u.guest OR u.webhook OR u.declared_minor THEN RETURN false; END IF;
    IF u.bot THEN
        SELECT owner_id INTO owner FROM applications WHERE bot_user_id = uid;
        IF owner IS NULL THEN RETURN false; END IF;
        RETURN age_meets(owner, need);
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM age_assurances a
         WHERE a.user_id = uid AND a.threshold >= need AND a.revoked_at IS NULL
           AND (a.expires_at IS NULL OR a.expires_at > now())
           AND age_level_rank(a.level) >= age_level_rank(age_accept_level()));
END $$;

-- The age a channel asks for: the highest of its own, its parents' (a thread's channel, a channel's category)
-- and its server's. NULL when none applies. DMs have none.
CREATE FUNCTION channel_min_age(cid UUID) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(GREATEST(COALESCE(c.min_age, 0), COALESCE(p.min_age, 0), COALESCE(pp.min_age, 0), COALESCE(g.min_age, 0)), 0)::int
      FROM channels c
      LEFT JOIN channels p ON p.id = c.parent_id
      LEFT JOIN channels pp ON pp.id = p.parent_id
      LEFT JOIN guilds g ON g.id = c.guild_id
     WHERE c.id = cid
$$;
