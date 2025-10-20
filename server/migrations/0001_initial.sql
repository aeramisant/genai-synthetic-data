-- 0001_initial.sql
-- Initial tables (matches existing structure minus later additions)
CREATE TABLE IF NOT EXISTS generated_datasets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  schema_definition TEXT NOT NULL,
  generation_meta JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS generated_data (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER REFERENCES generated_datasets(id) ON DELETE CASCADE,
  table_name VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_data_dataset ON generated_data(dataset_id);
