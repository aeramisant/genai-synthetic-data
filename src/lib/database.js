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

import fs from 'fs';
import path from 'path';

async function setupDatabase() {
  try {
    await pool.query('SELECT 1');
    // Ensure migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(process.cwd(), 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.warn('Migrations directory not found:', migrationsDir);
      return;
    }
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => /\.sql$/i.test(f))
      .sort();
    const appliedRes = await pool.query(
      'SELECT filename FROM schema_migrations'
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));
    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      console.log('Applying migration:', file);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        console.error('Migration failed:', file, e.message);
        throw e;
      }
    }
    console.log('Database setup completed');
  } catch (error) {
    console.error('Error setting up database:', error);
    console.error('Make sure PostgreSQL is running and the database exists');
    console.error('Try creating the database with: createdb synthetic_data');
    throw error;
  }
}

export { pool, setupDatabase };
