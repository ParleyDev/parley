-- The instance's own account ("Parley"): it sends official notices (for example after an admin acts on a report) as
-- DMs that can be read but not answered. Exactly one is created on first use.
ALTER TABLE users ADD COLUMN system BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_one_system ON users (system) WHERE system;
