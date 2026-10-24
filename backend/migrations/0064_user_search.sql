-- Finding people: partial-name search only returns users who opt in (Content & Social); an exact username always
-- matches, and admins search everyone.
ALTER TABLE users ADD COLUMN searchable BOOLEAN NOT NULL DEFAULT false;
