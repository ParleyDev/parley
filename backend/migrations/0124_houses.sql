-- An opt-in house badge on the profile (Ember, Tide or Grove), picked in Settings → Profiles.
ALTER TABLE users ADD COLUMN house TEXT NOT NULL DEFAULT '';
