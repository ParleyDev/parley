-- Data & Privacy: let others see that you read their DMs ("Seen") and that you are typing.
ALTER TABLE users ADD COLUMN show_read_receipts BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN show_typing BOOLEAN NOT NULL DEFAULT true;
