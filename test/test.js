require('dotenv').config();
import fs from 'fs/promises';
import path from 'path';
import DataGenerator from '../src/lib/dataGenerator.js';

async function test() {
  try {
    // Create an instance of DataGenerator
    const generator = new DataGenerator();

    // Read the sample DDL file
    const ddlContent = await fs.readFile(
      path.join(__dirname, 'sample.ddl'),
      'utf-8'
    );

    console.log('Parsing DDL...');
    const schema = await generator.parseDDL(ddlContent);
    console.log('Parsed Schema:', JSON.stringify(schema, null, 2));

    console.log('\nGenerating synthetic data...');
    const data = await generator.generateSyntheticData(
      schema,
      'Generate 5 records for each table'
    );
    console.log('Generated Data:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
