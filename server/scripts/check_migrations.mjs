import { setupDatabase, pool } from '../server/src/lib/database.js';

(async () => {
  try {
    await setupDatabase();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM schema_migrations`
    );
    if (rows[0].cnt === 0) {
      console.error('ERROR: No migrations applied.');
      process.exit(1);
    }
    console.log(`Migrations applied: ${rows[0].cnt}`);
    process.exit(0);
  } catch (e) {
    console.error('Migration check failed:', e.message);
    process.exit(1);
  }
})();
