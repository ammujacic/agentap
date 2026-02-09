-- Migration: 0002_two_factor
-- Adds two-factor authentication support

-- Add twoFactorEnabled flag to user table
ALTER TABLE user ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;

-- Two-factor secrets and backup codes table (Better Auth twoFactor plugin)
CREATE TABLE IF NOT EXISTS twoFactor (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  secret TEXT,
  backup_codes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_two_factor_user ON twoFactor(user_id);
