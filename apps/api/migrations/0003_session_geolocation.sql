-- Migration: 0003_session_geolocation
-- Adds geolocation tracking to sessions using Cloudflare's cf object

ALTER TABLE session ADD COLUMN city TEXT;
ALTER TABLE session ADD COLUMN region TEXT;
ALTER TABLE session ADD COLUMN country TEXT;
