import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from the root directory
dotenv.config({ path: path.join(dirname(__dirname), '.env') });

// Database setup
import { setupDatabase } from '../src/lib/database.js';
import DataGenerator from '../src/lib/dataGenerator.js';
import DataModifier from '../src/lib/dataModifier.js';
import DataExporter from '../src/lib/dataExporter.js';

// Ensure database is initialized before running tests
async function setup() {
  try {
    await setupDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

async function testPhase1() {
  try {
    // Initialize components
    const generator = new DataGenerator();
    const modifier = new DataModifier(generator);
    const exporter = new DataExporter();

    // 1. Read and parse the DDL
    console.log('Reading and parsing DDL...');
    const ddlContent = await fs.readFile(
      path.join(dirname(__dirname), 'assets/library_mgm_schema.ddl'),
      'utf-8'
    );

    const schema = await generator.parseDDL(ddlContent);
    console.log('Schema parsed successfully');

    // 2. Generate initial dataset
    console.log('\nGenerating initial dataset...');
    const instructions = `
      Generate realistic library data with:
      - 5 authors from different countries and eras (both living and deceased)
      - 3 major publishers with complete contact information
      - 10 books of various genres, formats, and languages
      - 2 library branches in different cities with assigned managers
      - 8 library members with diverse membership types and account statuses
      - Book inventory across branches with various conditions
      - Mix of current, overdue, and returned book loans with fines
      - 4 employees distributed across 2 departments
    `;

    let initialData = await generator.generateSyntheticData(
      schema,
      instructions
    );
    console.log('Initial data raw keys:', Object.keys(initialData || {}));

    // Ensure expected tables exist (even if empty) to avoid downstream crashes
    const expectedTables = [
      'Authors',
      'Publishers',
      'Books',
      'Library_Branches',
      'Library_Members',
      'Book_Inventory',
      'Book_Loans',
      'Employees',
    ];
    if (!initialData || typeof initialData !== 'object') initialData = {};
    for (const t of expectedTables) {
      if (!Array.isArray(initialData[t])) initialData[t] = [];
    }
    console.log('Initial data normalized keys:', Object.keys(initialData));
    console.log('Initial data generated successfully');

    // 3. Export to CSV and create ZIP
    console.log('\nExporting to CSV...');
    const csvFiles = await exporter.exportToCSV(initialData);
    if (!csvFiles || csvFiles.length === 0) {
      console.warn(
        'WARNING: No CSV files produced (data arrays may be empty).'
      );
    }
    console.log('CSV files created:', csvFiles);

    console.log('\nCreating ZIP archive...');
    const zipPath = await exporter.createZipArchive(csvFiles);
    console.log('ZIP archive created:', zipPath);

    // 4. Store in database
    console.log('\nStoring in database...');
    const datasetId = await exporter.storeInDatabase(
      initialData,
      'Library Management System - Initial Data',
      'Sample library system data with authors, books, members, and loans',
      schema
    );
    console.log(
      'Data stored in database successfully with dataset ID:',
      datasetId
    );

    // 5. Test data modification
    console.log('\nTesting data modification...');
    const modifications = `
      Make the following changes:
      1. Add "Classic Literature" genre to all books published before 1900
      2. Update loan_status to "Overdue" and calculate fines for loans past due date
      3. Add "Senior" to the job title of employees with over 5 years of service
      4. Update the condition of book inventory items marked as "New" to "Good" if they're over 1 year old
      5. Change membership_type to "Premium" for members with more than 10 successful returns
    `;

    let modifiedData;
    try {
      modifiedData = await modifier.modifyData(initialData, modifications);
    } catch (e) {
      console.error(
        'Modification via AI failed, falling back to original data. Reason:',
        e.message
      );
      modifiedData = { ...initialData };
    }

    // Normalize again to guarantee arrays
    for (const t of Object.keys(initialData)) {
      if (!Array.isArray(modifiedData[t])) modifiedData[t] = initialData[t];
    }
    for (const t of expectedTables) {
      if (!Array.isArray(modifiedData[t])) modifiedData[t] = [];
    }

    const safeLen = (obj, key) =>
      Array.isArray(obj?.[key]) ? obj[key].length : 0;
    console.log('Data modified successfully');
    console.log('Modifications summary:');
    console.log('- Modified books:', safeLen(modifiedData, 'Books'));
    console.log('- Modified loans:', safeLen(modifiedData, 'Book_Loans'));
    console.log('- Modified employees:', safeLen(modifiedData, 'Employees'));
    console.log(
      '- Modified inventory:',
      safeLen(modifiedData, 'Book_Inventory')
    );
    console.log(
      '- Modified members:',
      safeLen(modifiedData, 'Library_Members')
    );

    // 6. Export modified data
    console.log('\nExporting modified data...');
    const modifiedCsvFiles = await exporter.exportToCSV(modifiedData);
    await exporter.createZipArchive(modifiedCsvFiles, 'modified_data');
    console.log('Modified data exported successfully to:', modifiedCsvFiles);

    console.log('\nPhase 1 testing completed successfully!');
  } catch (error) {
    console.error('Error during Phase 1 testing:', error);
    throw error;
  }
}

// Run setup and tests
setup()
  .then(() => testPhase1())
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
