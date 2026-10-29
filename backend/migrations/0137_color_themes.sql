-- Colour themes (Discord's gradient themes): a full-app gradient over a light or dark base. Names and everything else
-- are data, edited in the admin console; the built-in ones can be disabled but not deleted.
CREATE TABLE color_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    base TEXT NOT NULL CHECK (base IN ('light', 'dark')),
    angle DOUBLE PRECISION NOT NULL DEFAULT 180,
    midpoint DOUBLE PRECISION NOT NULL DEFAULT 50,
    stops JSONB NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    builtin BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO color_themes (name, slug, base, angle, midpoint, stops, sort_order, builtin) VALUES
('Mint Apple', 'mint-apple', 'light', 180.0, 27.0, '[{"color": "#56b69f", "pos": 6.15}, {"color": "#63bc61", "pos": 48.7}, {"color": "#9eca67", "pos": 93.07}]'::jsonb, 1, true),
('Citrus Sherbert', 'citrus-sherbert', 'light', 180.0, 27.0, '[{"color": "#f3b336", "pos": 31.1}, {"color": "#ee8558", "pos": 67.09}]'::jsonb, 2, true),
('Retro Raincloud', 'retro-raincloud', 'light', 148.71, 50.0, '[{"color": "#3a7ca1", "pos": 5.64}, {"color": "#7f7eb9", "pos": 26.38}, {"color": "#7f7eb9", "pos": 49.92}, {"color": "#3a7ca1", "pos": 73.12}]'::jsonb, 3, true),
('Hanami', 'hanami', 'light', 38.08, 50.0, '[{"color": "#efaab3", "pos": 3.56}, {"color": "#efd696", "pos": 35.49}, {"color": "#a6daa2", "pos": 68.78}]'::jsonb, 4, true),
('Sunrise', 'sunrise', 'light', 154.19, 50.0, '[{"color": "#9f4175", "pos": 8.62}, {"color": "#c49064", "pos": 48.07}, {"color": "#a6953d", "pos": 76.04}]'::jsonb, 5, true),
('Cotton Candy', 'cotton-candy', 'light', 180.14, 50.0, '[{"color": "#f4abb8", "pos": 8.5}, {"color": "#b1c2fc", "pos": 94.28}]'::jsonb, 6, true),
('LoFi Vibes', 'lofi-vibes', 'light', 179.52, 27.0, '[{"color": "#a4c0f7", "pos": 7.08}, {"color": "#a9e4e8", "pos": 34.94}, {"color": "#b0e2b8", "pos": 65.12}, {"color": "#cfdfa2", "pos": 96.23}]'::jsonb, 7, true),
('Desert Khaki', 'desert-khaki', 'light', 38.99, 50.0, '[{"color": "#e7dbd0", "pos": 12.92}, {"color": "#dfd0b2", "pos": 32.92}, {"color": "#e0d6a3", "pos": 52.11}]'::jsonb, 8, true),
('Sunset', 'sunset', 'dark', 141.68, 35.0, '[{"color": "#48288c", "pos": 27.57}, {"color": "#db7f4b", "pos": 71.25}]'::jsonb, 9, true),
('Chroma Glow', 'chroma-glow', 'dark', 128.92, 15.0, '[{"color": "#0eb5bf", "pos": 3.94}, {"color": "#4c0ce0", "pos": 26.1}, {"color": "#a308a7", "pos": 39.82}, {"color": "#9a53ff", "pos": 56.89}, {"color": "#218be0", "pos": 76.45}]'::jsonb, 10, true),
('Forest', 'forest', 'dark', 162.27, 50.0, '[{"color": "#142215", "pos": 11.2}, {"color": "#2d4d39", "pos": 29.93}, {"color": "#454c32", "pos": 48.64}, {"color": "#5a7c58", "pos": 67.85}, {"color": "#a98e4b", "pos": 83.54}]'::jsonb, 11, true),
('Crimson Moon', 'crimson-moon', 'dark', 64.92, 30.0, '[{"color": "#950909", "pos": 16.17}, {"color": "#000000", "pos": 72.0}]'::jsonb, 12, true),
('Midnight Blurple', 'midnight-blurple', 'dark', 48.17, 24.0, '[{"color": "#5348ca", "pos": 11.21}, {"color": "#140730", "pos": 61.92}]'::jsonb, 13, true),
('Mars', 'mars', 'dark', 170.82, 50.0, '[{"color": "#895240", "pos": 14.61}, {"color": "#8f4343", "pos": 74.62}]'::jsonb, 14, true),
('Dusk', 'dusk', 'dark', 180.0, 50.0, '[{"color": "#665069", "pos": 12.84}, {"color": "#91a3d1", "pos": 85.99}]'::jsonb, 15, true),
('Under the Sea', 'under-the-sea', 'dark', 179.14, 50.0, '[{"color": "#647962", "pos": 1.91}, {"color": "#588575", "pos": 48.99}, {"color": "#6a8482", "pos": 96.35}]'::jsonb, 16, true),
('Retro Storm', 'retro-storm', 'dark', 148.71, 61.0, '[{"color": "#3a7ca1", "pos": 5.64}, {"color": "#58579a", "pos": 26.38}, {"color": "#58579a", "pos": 49.92}, {"color": "#3a7ca1", "pos": 73.12}]'::jsonb, 17, true),
('Neon Nights', 'neon-nights', 'dark', 180.0, 50.0, '[{"color": "#01a89e", "pos": 0.0}, {"color": "#7d60ba", "pos": 50.0}, {"color": "#b43898", "pos": 100.0}]'::jsonb, 18, true),
('Strawberry Lemonade', 'strawberry-lemonade', 'dark', 161.03, 32.0, '[{"color": "#af1a6c", "pos": 18.79}, {"color": "#c26b20", "pos": 49.76}, {"color": "#e7a525", "pos": 80.72}]'::jsonb, 19, true),
('Aurora', 'aurora', 'dark', 239.16, 34.0, '[{"color": "#062053", "pos": 10.39}, {"color": "#191fbb", "pos": 26.87}, {"color": "#13929a", "pos": 48.31}, {"color": "#218573", "pos": 64.98}, {"color": "#051a81", "pos": 92.5}]'::jsonb, 20, true),
('Sepia', 'sepia', 'dark', 69.98, 50.0, '[{"color": "#857664", "pos": 14.14}, {"color": "#5b4421", "pos": 60.35}]'::jsonb, 21, true),
('Blurple Twilight', 'blurple-twilight', 'dark', 47.61, 50.0, '[{"color": "#2c3fe7", "pos": 11.18}, {"color": "#261d83", "pos": 64.54}]'::jsonb, 22, true);

-- A server's theme for its members (unless they keep their own): {"id": theme} or {"custom": {base, angle, midpoint, stops}}.
ALTER TABLE guilds ADD COLUMN theme JSONB;
