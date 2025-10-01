import DataGenerator from '../src/lib/dataGenerator.js';
import DataExporter from '../src/lib/dataExporter.js';
import fs from 'fs';
import { pool, setupDatabase } from '../src/lib/database.js';

(async () => {
  try {
    await setupDatabase();
    const dg = new DataGenerator();
    const ddl = fs.readFileSync('./assets/library_mgm_schema.ddl', 'utf8');
    const schema = await dg.parseDDL(ddl);
    const gen = await dg.generateSyntheticData(schema, '', {
      numRecords: 2,
      seed: 13,
      withMeta: true,
    });
    const exporter = new DataExporter();
    const id = await exporter.storeInDatabase(
      gen,
      'Meta Persist Test',
      'Testing generation_meta persistence',
      schema
    );
    console.log('Stored id', id);
    const row = await pool.query(
      `SELECT id, generation_meta->>'seed' AS seed, json_array_length(generation_meta->'order') AS table_order_len FROM generated_datasets WHERE id=$1`,
      [id]
    );
    console.log('Fetched meta summary', row.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
