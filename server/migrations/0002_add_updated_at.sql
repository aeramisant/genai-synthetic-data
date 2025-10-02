-- 0002_add_updated_at.sql
-- Adds an updated_at timestamp column to track dataset modifications.
-- Safe to run multiple times because of IF NOT EXISTS guard.

ALTER TABLE generated_datasets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- Optionally backfill updated_at for existing rows (set to created_at if null)
UPDATE generated_datasets
  SET updated_at = COALESCE(updated_at, created_at)
  WHERE updated_at IS NULL;
