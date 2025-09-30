import pg from 'pg';
const { Pool } = pg;

const config = {
  user: process.env.POSTGRES_USER || 'aeramisant',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'synthetic_data',
  password: process.env.POSTGRES_PASSWORD || '',
  port: process.env.POSTGRES_PORT || 5432,
};

console.log('Database config:', {
  ...config,
  password: config.password ? '[REDACTED]' : '',
});

const pool = new Pool(config);

async function setupDatabase() {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');

    // Create necessary tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_datasets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        schema_definition TEXT NOT NULL,
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
    `);

    // Lightweight idempotent migrations (non-destructive)
    // Ensure description column exists (older versions lacked it)
    await pool.query(
      `ALTER TABLE generated_datasets
       ADD COLUMN IF NOT EXISTS description TEXT`
    );

    // Future migration examples (left as comments for clarity):
    // await pool.query(`ALTER TABLE generated_datasets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
    // await pool.query(`ALTER TABLE generated_data ADD COLUMN IF NOT EXISTS some_new_column TEXT`);

    console.log('Database setup completed');
  } catch (error) {
    console.error('Error setting up database:', error);
    console.error('Make sure PostgreSQL is running and the database exists');
    console.error('Try creating the database with: createdb synthetic_data');
    throw error;
  }
}

export { pool, setupDatabase };
