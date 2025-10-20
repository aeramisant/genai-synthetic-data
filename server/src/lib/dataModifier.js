import DataExporter from './dataExporter.js';
import { pool } from './database.js';

class DataModifier {
  constructor(dataGenerator) {
    this.generator = dataGenerator;
    this.exporter = new DataExporter();
  }

  async modifyDataset(datasetId, modifications) {
    try {
      // Fetch the existing dataset
      const result = await pool.query(
        'SELECT schema_definition FROM generated_datasets WHERE id = $1',
        [datasetId]
      );

      if (result.rows.length === 0) {
        throw new Error('Dataset not found');
      }

      const schema = result.rows[0].schema_definition;

      // Get all data for this dataset
      const dataResult = await pool.query(
        'SELECT table_name, data FROM generated_data WHERE dataset_id = $1',
        [datasetId]
      );

      // Group data by table
      const currentData = dataResult.rows.reduce((acc, row) => {
        if (!acc[row.table_name]) acc[row.table_name] = [];
        acc[row.table_name].push(row.data);
        return acc;
      }, {});

      // Use the generator to modify the data
      const modifiedData = await this.generator.modifyGeneratedData(
        currentData,
        modifications
      );

      // Start a transaction for updating the data
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete existing data for this dataset
        await client.query('DELETE FROM generated_data WHERE dataset_id = $1', [
          datasetId,
        ]);

        // Insert modified data
        for (const [tableName, records] of Object.entries(modifiedData)) {
          if (!Array.isArray(records)) continue;
          for (const record of records) {
            await client.query(
              'INSERT INTO generated_data (dataset_id, table_name, data) VALUES ($1, $2, $3)',
              [datasetId, tableName, JSON.stringify(record)]
            );
          }
        }

        // Update the dataset's updated_at timestamp
        // Add updated_at column lazily if it doesn't exist, then update
        await client.query(
          `ALTER TABLE generated_datasets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`
        );
        await client.query(
          'UPDATE generated_datasets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [datasetId]
        );

        await client.query('COMMIT');

        // Export the modified data to CSV and create a ZIP archive
        const csvFiles = await this.exporter.exportToCSV(modifiedData);
        const zipPath = await this.exporter.createZipArchive(
          csvFiles,
          `dataset_${datasetId}_modified`
        );

        return {
          success: true,
          modifiedData,
          exportPath: zipPath,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error modifying dataset:', error);
      throw error;
    }
  }

  // Backwards compatible alias expected by test script
  async modifyData(data, modifications) {
    // If test passes raw data instead of datasetId, just call generator directly
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return this.generator.modifyGeneratedData(data, modifications);
    }
    throw new Error(
      'modifyData expects in-memory dataset object; got something else.'
    );
  }

  async validateModifiedData(schema, data) {
    // Implement validation logic here
    // Check data types, constraints, and relationships
    return true;
  }
}

export default DataModifier;
