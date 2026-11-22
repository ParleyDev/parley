-- Attachment links are signed and expire from here on (media_sign.rs). Files uploaded before this moment keep
-- working at their plain address, as they always have: links to them are already out in the world (pasted into
-- other chats, bookmarked, stored by bots), and breaking those protects nobody who has not already been sent the
-- file. Only attachments created after this timestamp need a signed link or a member's login.
INSERT INTO instance_settings (key, value) VALUES ('attachment_links_signed_since', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;
