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

    // --- Resilience: Re-create core tables if manually dropped after migrations were recorded ---
    const coreTables = ['generated_datasets', 'generated_data'];
    const missing = [];
    for (const t of coreTables) {
      const res = await pool.query(
        `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [t]
      );
      if (res.rows[0].c === 0) missing.push(t);
    }
    if (missing.length) {
      console.warn(
        '[db] Detected missing core tables:',
        missing.join(', '),
        '— attempting recovery.'
      );
      // Re-run 0001_initial.sql regardless of recorded state
      const initialPath = path.join(migrationsDir, '0001_initial.sql');
      if (fs.existsSync(initialPath)) {
        try {
          const initialSQL = fs.readFileSync(initialPath, 'utf-8');
          await pool.query(initialSQL);
          console.log(
            '[db] Re-applied 0001_initial.sql to restore core tables.'
          );
        } catch (e) {
          console.error('[db] Failed to re-apply 0001_initial.sql:', e.message);
        }
      } else {
        console.error(
          '[db] Cannot recover missing tables; migration file 0001_initial.sql not found.'
        );
      }
      // Ensure updated_at column present (0002)
      try {
        await pool.query(
          'ALTER TABLE generated_datasets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP'
        );
        await pool.query(
          'UPDATE generated_datasets SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL'
        );
      } catch (e) {
        console.warn('[db] Failed ensuring updated_at column:', e.message);
      }
    }
    // --- End resilience block ---
  } catch (error) {
    console.error('Error setting up database:', error);
    console.error('Make sure PostgreSQL is running and the database exists');
    console.error('Try creating the database with: createdb synthetic_data');
    throw error;
  }
}

export { pool, setupDatabase };
