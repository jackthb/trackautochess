-- Cache Steam avatar URLs for OG image generation. The OG route still falls
-- back to Steam if this value is missing, then fills it for future renders.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
