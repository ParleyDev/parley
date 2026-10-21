-- Per-user maximum size of a single upload (NULL = the instance default, Instance Settings max_upload_bytes).
ALTER TABLE users ADD COLUMN max_upload_bytes BIGINT;
