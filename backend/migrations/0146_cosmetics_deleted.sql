-- Deleting an assets-folder item is Parley's alone: the files stay, the item is hidden everywhere (and can be restored).
ALTER TABLE cosmetics ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
