import { pool } from '../lib/database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DatasetManager {
  constructor() {
    // Remove circular dependency
    this.outputDir = path.join(process.cwd(), 'output');
  }

  async saveDataset(
    name,
    description,
    schemaDefinition,
    data,
    generationMeta = null
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Store dataset metadata
      const datasetResult = await client.query(
        `INSERT INTO generated_datasets (name, description, schema_definition, generation_meta)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          name,
          description,
          JSON.stringify(schemaDefinition),
          generationMeta ? JSON.stringify(generationMeta) : null,
        ]
      );

      const datasetId = datasetResult.rows[0].id;

      // Store actual data for each table
      for (const [tableName, records] of Object.entries(data)) {
        if (!Array.isArray(records) || records.length === 0) continue;

        // Store records in batches of 1000
        const batchSize = 1000;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          await client.query(
            `INSERT INTO generated_data (dataset_id, table_name, data)
             VALUES ${batch
               .map((_, idx) => `($1, $2, $${idx + 3})`)
               .join(',')}`,
            [
              datasetId,
              tableName,
              ...batch.map((record) => JSON.stringify(record)),
            ]
          );
        }
      }

      await client.query('COMMIT');
      return datasetId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getDataset(datasetId) {
    const client = await pool.connect();
    try {
      // Get dataset metadata
      const metadataResult = await client.query(
        'SELECT * FROM generated_datasets WHERE id = $1',
        [datasetId]
      );

      if (metadataResult.rows.length === 0) {
        throw new Error(`Dataset with id ${datasetId} not found`);
      }

      // Get all data for this dataset
      const dataResult = await client.query(
        'SELECT table_name, data FROM generated_data WHERE dataset_id = $1',
        [datasetId]
      );

      // Organize data by table
      const data = dataResult.rows.reduce((acc, row) => {
        if (!acc[row.table_name]) acc[row.table_name] = [];
        acc[row.table_name].push(row.data);
        return acc;
      }, {});

      return {
        metadata: metadataResult.rows[0],
        data,
      };
    } finally {
      client.release();
    }
  }

  async listDatasets() {
    const result = await pool.query(
      `SELECT id AS dataset_id, name, description, created_at 
       FROM generated_datasets 
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  async deleteDataset(datasetId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM generated_data WHERE dataset_id = $1', [
        datasetId,
      ]);
      await client.query('DELETE FROM generated_datasets WHERE id = $1', [
        datasetId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export default DatasetManager;
