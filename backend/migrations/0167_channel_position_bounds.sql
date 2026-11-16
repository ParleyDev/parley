-- Positions are bounded to 0..=100000 on write; clamp rows stored before the bound existed so that resending them
-- in a reorder cannot fail.
UPDATE channels SET position = 100000 WHERE position > 100000;
UPDATE channels SET position = 0 WHERE position < 0;
