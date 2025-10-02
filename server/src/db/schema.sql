-- Schema for storing generated datasets
CREATE TABLE generated_datasets (
    dataset_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    schema_definition JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing the actual generated data
CREATE TABLE generated_data (
    data_id SERIAL PRIMARY KEY,
    dataset_id INTEGER REFERENCES generated_datasets(dataset_id),
    table_name VARCHAR(255) NOT NULL,
    record_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries on generated data
CREATE INDEX idx_generated_data_dataset_table ON generated_data(dataset_id, table_name);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update the updated_at column
CREATE TRIGGER update_generated_datasets_updated_at
    BEFORE UPDATE ON generated_datasets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
