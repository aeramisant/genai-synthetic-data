const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Parser } = require('node-sql-parser');

class DataGenerator {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    });
    this.parser = new Parser();
    this.options = {
      database: 'MySQL',
      multipleStatements: true,
    };
  }

  _processAST(ast) {
    const schema = {
      tables: {},
      relationships: [],
    };

    // Handle both single statement and multiple statements
    const statements = Array.isArray(ast) ? ast : [ast];

    for (const statement of statements) {
      if (statement.type === 'create' && statement.keyword === 'table') {
        const tableName = statement.table[0].table;
        const tableSchema = {
          name: tableName,
          columns: {},
          primaryKey: null,
          foreignKeys: [],
        };

        // Process columns
        for (const col of statement.create_definitions) {
          if (col.resource === 'column') {
            tableSchema.columns[col.column.column] = {
              type: col.definition.dataType,
              nullable: !col.nullable || col.nullable.value === 'null',
              default: col.definition.default?.value,
            };
          } else if (col.resource === 'constraint') {
            if (col.constraint_type === 'primary key') {
              tableSchema.primaryKey = col.definition.columns.map(
                (c) => c.column
              );
            } else if (col.constraint_type === 'foreign key') {
              tableSchema.foreignKeys.push({
                columns: col.definition.columns.map((c) => c.column),
                referenceTable: col.definition.reference.table,
                referenceColumns: col.definition.reference.columns.map(
                  (c) => c.column
                ),
              });
            }
          }
        }

        schema.tables[tableName] = tableSchema;
      }
    }

    return schema;
  }

  async _enhanceSchemaWithAI(schema, originalDDL) {
    const prompt = `
      Analyze this database schema and suggest:
      1. Realistic value ranges and patterns for each column
      2. Potential data relationships and constraints not explicitly defined
      3. Business rules that should be considered when generating data
      
      Schema:
      ${JSON.stringify(schema, null, 2)}
      
      Original DDL:
      ${originalDDL}
      
      Return the enhanced schema with your suggestions in JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const text = result.response.text();
    // Remove any markdown code blocks if present
    const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
    return { ...schema, suggestions: JSON.parse(jsonStr) };
  }

  async parseDDL(ddlContent) {
    try {
      // First try to parse the DDL using the SQL parser
      const ast = this.parser.parse(ddlContent, this.options);

      // Transform the AST into a structured schema
      const schema = this._processAST(ast);

      // Use Gemini to enhance the schema with additional insights
      return await this._enhanceSchemaWithAI(schema, ddlContent);
    } catch (error) {
      console.error('Error parsing DDL:', error);

      // Fallback to using Gemini directly if SQL parsing fails
      const prompt = `
        Parse this DDL and return a JSON structure with:
        1. Table definitions
        2. Column types and constraints
        3. Relationships between tables
        
        DDL:
        ${ddlContent}

        IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
      `;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      // Remove any markdown code blocks if present
      const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
      return JSON.parse(jsonStr);
    }
  }

  async generateSyntheticData(schema, instructions, config = {}) {
    const { numRecords = 100, temperature = 0.7 } = config;

    const prompt = `
      Generate synthetic data based on the following schema and instructions.
      Generate ${numRecords} records for each table while maintaining referential integrity.
      
      Schema:
      ${JSON.stringify(schema, null, 2)}
      
      Additional Instructions:
      ${instructions || 'Generate realistic and consistent data'}
      
      Return the data in JSON format with table names as keys and arrays of records as values.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);

    const text = result.response.text();
    // Remove any markdown code blocks if present
    const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
    return JSON.parse(jsonStr);
  }

  async modifyGeneratedData(data, modifications) {
    const prompt = `
      Modify the following dataset according to these instructions:
      ${modifications}
      
      Current Data:
      ${JSON.stringify(data, null, 2)}
      
      Return the modified data in the same JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const text = result.response.text();
    // Remove any markdown code blocks if present
    const jsonStr = text.replace(/```json\n|\n```/g, '').trim();
    return JSON.parse(jsonStr);
  }
}

module.exports = DataGenerator;
