-- Profile cosmetics managed by instance admins: avatar decorations, nameplates, profile effects and profile frames.
-- A row is keyed by the value users store: a built-in preset ("gold"), an assets-folder item ("asset:<id>") or an
-- admin-made one ("custom:<uuid>", custom = true, its look in `data`). Rows for built-in and folder items only
-- rename or turn them off; custom rows are the item.
CREATE TABLE cosmetics (
    kind TEXT NOT NULL CHECK (kind IN ('decoration', 'nameplate', 'effect', 'frame')),
    value TEXT NOT NULL,
    custom BOOLEAN NOT NULL DEFAULT false,
    name TEXT,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, value)
);
