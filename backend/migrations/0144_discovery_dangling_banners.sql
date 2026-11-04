-- Discover listings whose banner was deleted when the server's own banner changed (they shared the picture):
-- fall back to the server's banner.
UPDATE guild_discovery d SET banner_url = NULL
WHERE d.banner_url LIKE '/api/images/%'
  AND NOT EXISTS (SELECT 1 FROM images i WHERE d.banner_url = '/api/images/' || i.id::text);
