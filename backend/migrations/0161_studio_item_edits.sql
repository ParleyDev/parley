-- Studio: edits that two members can make to one item at once, tracks that only their owner edits, and versions the
-- server saves by itself.

-- A protected track is edited by its owner and the engineers only.
ALTER TABLE studio_lanes ADD COLUMN protected BOOLEAN NOT NULL DEFAULT false;

-- Solo is each listener's own now (kept in their client); nothing shared is soloed.
UPDATE studio_lanes SET solo = false WHERE solo;

-- Versions saved by the server while a project is being edited, pruned apart from the ones members save.
ALTER TABLE studio_versions ADD COLUMN auto BOOLEAN NOT NULL DEFAULT false;

-- The batches of edits a project has taken, by the id their sender gave them: one sent again (its answer was lost)
-- is not applied twice. Kept for a day.
CREATE TABLE studio_op_batches (
    id         UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    version    BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX studio_op_batches_project_idx ON studio_op_batches(project_id, created_at);
