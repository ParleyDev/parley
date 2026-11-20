-- A DM that replies or reacts to the other person's custom status: {user_id, text, reaction}. The status text is
-- copied when the message is sent, so the reply still makes sense after they change it.
ALTER TABLE messages ADD COLUMN status_reply JSONB;
