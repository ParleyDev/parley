-- System messages can point at a related object (e.g. the thread a 'thread_created' notice is about).
-- New kinds: 'pins_add' (reply_to = the pinned message), 'thread_created' (ref_id = thread channel), 'member_join', 'call_started'.
ALTER TABLE messages ADD COLUMN ref_id UUID;
