-- Full-text index for global search. 'simple' keeps every word as typed (no stemming), and queries use prefix matching.
ALTER TABLE messages ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX messages_search_idx ON messages USING GIN (search);
