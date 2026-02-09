-- Migration: 0006_user_preferences
-- Adds user preferences table for auto-approve settings

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  auto_approve_low INTEGER NOT NULL DEFAULT 0,
  auto_approve_medium INTEGER NOT NULL DEFAULT 0,
  auto_approve_high INTEGER NOT NULL DEFAULT 0,
  auto_approve_critical INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
