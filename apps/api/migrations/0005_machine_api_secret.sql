-- Migration: 0005_machine_api_secret
-- Adds API secret hash for daemon-to-API authentication

ALTER TABLE machines ADD COLUMN api_secret_hash TEXT;
