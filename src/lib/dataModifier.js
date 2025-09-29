const DataExporter = require('./dataExporter');
const { pool } = require('./database');

class DataModifier {
  constructor(dataGenerator) {
    this.generator = dataGenerator;
    this.exporter = new DataExporter();
  }

  async modifyDataset(datasetId, modifications) {
    try {
      // Fetch the existing dataset
      const result = await pool.query(
        'SELECT schema_definition FROM generated_datasets WHERE dataset_id = $1',
        [datasetId]
      );

      if (result.rows.length === 0) {
        throw new Error('Dataset not found');
      }

      const schema = result.rows[0].schema_definition;

      // Get all data for this dataset
      const dataResult = await pool.query(
        'SELECT table_name, record_data FROM generated_data WHERE dataset_id = $1',
        [datasetId]
      );

      // Group data by table
      const currentData = dataResult.rows.reduce((acc, row) => {
        acc[row.table_name] = acc[row.table_name] || [];
        acc[row.table_name].push(row.record_data);
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
          for (const record of records) {
            await client.query(
              'INSERT INTO generated_data (dataset_id, table_name, record_data) VALUES ($1, $2, $3)',
              [datasetId, tableName, record]
            );
          }
        }

        // Update the dataset's updated_at timestamp
        await client.query(
          'UPDATE generated_datasets SET updated_at = CURRENT_TIMESTAMP WHERE dataset_id = $1',
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

  async validateModifiedData(schema, data) {
    // Implement validation logic here
    // Check data types, constraints, and relationships
    return true;
  }
}

module.exports = DataModifier;
