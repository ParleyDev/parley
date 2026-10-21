-- Roles get the same name styles as users: {font, effect, colors}. color / color_accent stay as the first two
-- colours for older clients.
ALTER TABLE roles ADD COLUMN name_style JSONB NOT NULL DEFAULT '{}'::jsonb;
