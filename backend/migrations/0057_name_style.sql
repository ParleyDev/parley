-- Display name style: {font, effect}; colours stay in name_primary / name_accent.
ALTER TABLE users ADD COLUMN name_style JSONB NOT NULL DEFAULT '{}'::jsonb;
