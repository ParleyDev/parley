-- Name appearance: a user-level colour (optionally a gradient) and a second colour for roles.
ALTER TABLE users ADD COLUMN name_primary TEXT, ADD COLUMN name_accent TEXT;
ALTER TABLE roles ADD COLUMN color_accent TEXT;
