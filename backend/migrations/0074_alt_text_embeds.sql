-- Attachment descriptions (alt text, read by screen readers and shown on hover) and "Remove embeds" on a message.
ALTER TABLE attachments ADD COLUMN description TEXT;
ALTER TABLE messages ADD COLUMN suppress_embeds BOOLEAN NOT NULL DEFAULT false;
