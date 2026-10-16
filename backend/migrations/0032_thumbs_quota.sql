-- Server-side thumbnails for image attachments and per-user upload quotas.
ALTER TABLE attachments ADD COLUMN thumb_type TEXT;              -- content type of <id>.thumb on disk, NULL when none
ALTER TABLE users ADD COLUMN upload_quota_bytes BIGINT;           -- NULL = instance default (UPLOAD_QUOTA_BYTES)
