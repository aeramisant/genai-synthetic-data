const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function setupDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_datasets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        schema_definition TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database setup completed');
  } catch (error) {
    console.error('Error setting up database:', error);
  }
}

module.exports = {
  pool,
  setupDatabase,
};
