import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { Parser } from 'json2csv';

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
          fields: Object.keys(records[0]),
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
      const output = createWriteStream(
        path.join(this.outputDir, `${archiveName}.zip`)
      );
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
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
      for (const file of files) {
        archive.file(file, { name: path.basename(file) });
      }

      archive.finalize();
    });
  }

  async storeInDatabase(data, name, description = '', schemaDefinition = null) {
    try {
      // Import DatasetManager using dynamic import to avoid circular dependency
      const { default: DatasetManager } = await import('./datasetManager.js');
      const manager = new DatasetManager();

      // If schema definition wasn't provided, extract it from the data
      if (!schemaDefinition) {
        schemaDefinition = Object.entries(data).reduce(
          (acc, [tableName, records]) => {
            if (records.length > 0) {
              acc[tableName] = {
                columns: Object.keys(records[0]).map((column) => ({
                  name: column,
                  type: typeof records[0][column],
                })),
              };
            }
            return acc;
          },
          {}
        );
      }

      // Store the dataset
      const datasetId = await manager.saveDataset(
        name || `Dataset_${new Date().toISOString()}`,
        description,
        schemaDefinition,
        data
      );

      return datasetId;
    } catch (error) {
      console.error('Error storing data in database:', error);
      throw error;
    }
  }
}

export default DataExporter;
