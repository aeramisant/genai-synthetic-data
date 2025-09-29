const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const { Parser } = require('json2csv');
const { pool } = require('./database');

class DataExporter {
  constructor() {
    this.outputDir = path.join(process.cwd(), 'output');
  }

  async exportToCSV(data) {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.outputDir, { recursive: true });

      const files = [];
      // Generate CSV for each table
      for (const [tableName, records] of Object.entries(data)) {
        if (!Array.isArray(records) || records.length === 0) continue;

        const parser = new Parser({
          fields: Object.keys(records[0])
        });
        const csv = parser.parse(records);
        const filePath = path.join(this.outputDir, `${tableName}.csv`);
        await fs.writeFile(filePath, csv);
        files.push(filePath);
      }

      return files;
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      throw error;
    }
  }

  async createZipArchive(files, archiveName = 'generated_data') {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(path.join(this.outputDir, `${archiveName}.zip`));
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      output.on('close', () => {
        console.log(`Archive created: ${archive.pointer()} bytes`);
        resolve(path.join(this.outputDir, `${archiveName}.zip`));
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add each CSV file to the archive
      files.forEach(file => {
        archive.file(file, { name: path.basename(file) });
      });

      archive.finalize();
    });
  }

  async storeInDatabase(data) {
    try {
      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const [tableName, records] of Object.entries(data)) {
          if (!Array.isArray(records) || records.length === 0) continue;

          // Get column names from the first record
          const columns = Object.keys(records[0]);
          
          // Generate placeholders for the prepared statement
          const placeholders = records.map((_, idx) => 
            `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(',')})`
          ).join(',');

          // Create the insert query
          const query = `
            INSERT INTO ${tableName} (${columns.join(',')})
            VALUES ${placeholders}
          `;

          // Flatten all values for the prepared statement
          const values = records.flatMap(record => columns.map(col => record[col]));

          await client.query(query, values);
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error storing data in database:', error);
      throw error;
    }
  }
}

module.exports = DataExporter;
