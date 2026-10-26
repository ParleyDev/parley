-- Event extras: a cover image, repeating events, and a status moderators move through (scheduled -> active ->
-- completed, or canceled). A repeating event that ends rolls forward to its next date, keeping its RSVPs.
ALTER TABLE guild_events
  ADD COLUMN cover_url TEXT,
  ADD COLUMN recurrence TEXT NOT NULL DEFAULT '' CHECK (recurrence IN ('', 'daily', 'weekly', 'biweekly', 'monthly')),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'canceled')),
  ADD COLUMN started_at TIMESTAMPTZ;
