-- Studio console: the engineer arms which band members record a take. NULL = everyone in the band (older sessions).
ALTER TABLE studio_sessions ADD COLUMN armed UUID[];
