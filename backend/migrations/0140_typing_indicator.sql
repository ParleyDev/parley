-- A custom typing indicator: {emojis: [up to 3], animation, text}; '{}' is the default "is typing…".
ALTER TABLE users ADD COLUMN typing_indicator JSONB NOT NULL DEFAULT '{}';
