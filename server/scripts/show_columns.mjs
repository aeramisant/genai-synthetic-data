import { pool, setupDatabase } from '../server/src/lib/database.js';

(async () => {
  try {
    await setupDatabase();
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='generated_datasets' ORDER BY ordinal_position`
    );
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
