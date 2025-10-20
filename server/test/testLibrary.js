require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const DataGenerator = require('../../src/lib/dataGenerator');

async function testLibrarySystem() {
  try {
    // Create an instance of DataGenerator
    const generator = new DataGenerator();

    // Read the library management system DDL file
    const ddlContent = await fs.readFile(
      path.join(__dirname, '../assets/library_mgm_schema.ddl'),
      'utf-8'
    );

    console.log('Parsing Library Management System DDL...');
    const schema = await generator.parseDDL(ddlContent);
    console.log('Parsed Schema:', JSON.stringify(schema, null, 2));

    // Instructions for realistic data generation
    const instructions = `
    Generate realistic library data with the following considerations:
    1. Generate 5 authors, 3 publishers, and 10 books
    2. Create 2 library branches
    3. Add 8 library members with different membership types
    4. Include various book formats and conditions
    5. Create realistic loan scenarios including some overdue books
    6. Generate 4 employees and 2 departments
    7. Ensure all foreign key relationships are maintained
    8. Use realistic names, addresses, and contact information
    `;

    console.log('\nGenerating synthetic library data...');
    const data = await generator.generateSyntheticData(schema, instructions, {
      temperature: 0.8,
      numRecords: 5, // This will be overridden by specific counts in instructions
    });
    // Optional: persist to DB instead of writing a JSON snapshot (set SAVE_DATASET=true)
    if (process.env.SAVE_DATASET === 'true') {
      try {
        const { default: DatasetManager } = await import(
          '../../src/lib/datasetManager.js'
        );
        const dm = new DatasetManager();
        // Basic schema wrapper expected by saveDataset: we already have schema object
        const datasetId = await dm.saveDataset(
          process.env.DATASET_NAME || 'Library_Test_Dataset',
          'Test library synthetic dataset',
          schema,
          data,
          { testScript: true }
        );
        console.log(
          `\nData generation complete! Persisted as dataset ID ${datasetId}`
        );
      } catch (persistErr) {
        console.warn('Skipping DB persistence (error):', persistErr.message);
      }
    } else {
      console.log(
        '\nData generation complete (not persisted, SAVE_DATASET!=true).'
      );
    }

    // Display a sample of the generated data
    console.log('\nSample of generated data:');
    if (data.Authors) {
      console.log('\nAuthors (first 2):');
      console.log(data.Authors.slice(0, 2));
    }
    if (data.Books) {
      console.log('\nBooks (first 2):');
      console.log(data.Books.slice(0, 2));
    }
  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
  }
}

// Run the test directly
testLibrarySystem().catch(console.error);
