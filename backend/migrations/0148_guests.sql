-- Guest accounts: "Try Parley" without signing up. A guest lives in the instance's demo server and is removed an hour
-- after it was last active, unless it is claimed with an email and password first.
ALTER TABLE users ADD COLUMN guest BOOLEAN NOT NULL DEFAULT false, ADD COLUMN guest_seen_at TIMESTAMPTZ;
CREATE INDEX users_guests ON users (guest_seen_at) WHERE guest;
