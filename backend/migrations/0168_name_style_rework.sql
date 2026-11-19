-- Display name style rework: system-font "fonts" became bundled typefaces, Prism and Holographic became Rainbow.
-- Map stored user and role styles to the new ids (routes/users.rs LEGACY_NAME_FONTS, HOLO_COLORS).
CREATE TEMP TABLE name_font_map (old TEXT PRIMARY KEY, new TEXT NOT NULL);
INSERT INTO name_font_map VALUES
  ('serif', 'slab'), ('mono', 'typewriter'), ('rounded', 'bubbly'), ('display', 'poster'), ('script', 'retro'),
  ('smallcaps', 'default'), ('condensed', 'poster'), ('wide', 'default'), ('italic', 'default');

UPDATE users u SET name_style = u.name_style || jsonb_build_object('font', m.new)
  FROM name_font_map m WHERE u.name_style->>'font' = m.old;
UPDATE roles r SET name_style = r.name_style || jsonb_build_object('font', m.new)
  FROM name_font_map m WHERE r.name_style->>'font' = m.old;

UPDATE users SET name_style = name_style || '{"effect": "rainbow", "colors": ["#8fb8ff", "#ffa8e4", "#d9c8ff", "#a8f0d4", "#8fb8ff"]}'::jsonb
  WHERE name_style->>'effect' = 'holographic';
UPDATE roles SET name_style = name_style || '{"effect": "rainbow", "colors": ["#8fb8ff", "#ffa8e4", "#d9c8ff", "#a8f0d4", "#8fb8ff"]}'::jsonb
  WHERE name_style->>'effect' = 'holographic';
UPDATE users SET name_style = name_style || '{"effect": "rainbow"}'::jsonb WHERE name_style->>'effect' = 'prism';
UPDATE roles SET name_style = name_style || '{"effect": "rainbow"}'::jsonb WHERE name_style->>'effect' = 'prism';

DROP TABLE name_font_map;
