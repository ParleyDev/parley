-- Root administration: account suspension and instance-wide settings.
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;
CREATE TABLE instance_settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);
INSERT INTO instance_settings (key, value) VALUES ('registration_enabled', 'true'), ('announcement', '""');
