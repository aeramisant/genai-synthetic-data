require('dotenv').config();

// Database setup
const { setupDatabase } = require('../src/lib/database');

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
const fs = require('fs').promises;
const path = require('path');
const DataGenerator = require('../src/lib/dataGenerator');
const DataModifier = require('../src/lib/dataModifier');
const DataExporter = require('../src/lib/dataExporter');

async function testPhase1() {
  try {
    // Initialize components
    const generator = new DataGenerator();
    const modifier = new DataModifier(generator);
    const exporter = new DataExporter();

    // 1. Read and parse the DDL
    console.log('Reading and parsing DDL...');
    const ddlContent = await fs.readFile(
      path.join(__dirname, '../assets/library_mgm_schema.ddl'),
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

    const initialData = await generator.generateSyntheticData(
      schema,
      instructions
    );
    console.log('Initial data generated successfully');

    // 3. Export to CSV and create ZIP
    console.log('\nExporting to CSV...');
    const csvFiles = await exporter.exportToCSV(initialData);
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

    // Verify data storage
    const DatasetManager = require('../src/lib/datasetManager');
    const manager = new DatasetManager();
    const storedDataset = await manager.getDataset(datasetId);
    console.log('\nVerifying stored data:');
    console.log('- Dataset name:', storedDataset.metadata.name);
    console.log('- Tables stored:', Object.keys(storedDataset.data).length);
    console.log(
      '- Total records:',
      Object.values(storedDataset.data).reduce(
        (sum, records) => sum + records.length,
        0
      )
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

    const modifiedData = await modifier.modifyData(initialData, modifications);
    console.log('Data modified successfully');
    console.log('Modifications summary:');
    console.log('- Modified books:', modifiedData.Books.length);
    console.log('- Modified loans:', modifiedData.Book_Loans.length);
    console.log('- Modified employees:', modifiedData.Employees.length);
    console.log('- Modified inventory:', modifiedData.Book_Inventory.length);
    console.log('- Modified members:', modifiedData.Library_Members.length);

    // 6. Export modified data
    console.log('\nExporting modified data...');
    const modifiedCsvFiles = await exporter.exportToCSV(modifiedData);
    await exporter.createZipArchive(modifiedCsvFiles, 'modified_data');
    console.log('Modified data exported successfully to:', modifiedCsvFiles);

    console.log('\nPhase 1 testing completed successfully!');
  } catch (error) {
    console.error('Error during Phase 1 testing:', error);
  }
}

// Run setup and tests
setup()
  .then(() => testPhase1())
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
