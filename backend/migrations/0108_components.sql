-- Message components (buttons, select menus) on bot messages; interactions from them, from modals, and autocomplete.
ALTER TABLE messages ADD COLUMN components JSONB;
ALTER TABLE interactions
  ADD COLUMN source_message_id UUID,
  ADD COLUMN choices JSONB;
