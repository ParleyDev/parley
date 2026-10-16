-- System messages in group DMs: 'recipient_add', 'recipient_remove', 'recipient_leave', 'channel_name_change', 'channel_icon_change'.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'default';
