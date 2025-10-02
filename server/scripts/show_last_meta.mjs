import { pool, setupDatabase } from '../server/src/lib/database.js';

(async () => {
  try {
    await setupDatabase();
    const res = await pool.query(
      `SELECT id, generation_meta->>'seed' AS seed, jsonb_array_length(generation_meta->'order') AS order_len FROM generated_datasets WHERE generation_meta IS NOT NULL ORDER BY id DESC LIMIT 1`
    );
    console.log(res.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
