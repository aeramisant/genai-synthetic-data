import { GoogleGenerativeAI } from '@google/generative-ai';
import pkg from 'node-sql-parser';
const { Parser } = pkg;

// --- Helper utilities ----------------------------------------------------
function stripCodeFences(text) {
  return text
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .trim();
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

function cleanGeminiJSON(raw, expected = 'object') {
  if (!raw || typeof raw !== 'string') return expected === 'array' ? [] : {};
  let text = stripCodeFences(raw)
    // Normalize newlines / spacing
    .replace(/\\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();

  // Attempt to locate first JSON object or array if extra prose exists
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let sliceStart = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    sliceStart = Math.min(firstBrace, firstBracket);
  } else {
    sliceStart = firstBrace !== -1 ? firstBrace : firstBracket;
  }
  if (sliceStart > 0) text = text.slice(sliceStart);

  // Trim trailing prose after final closing bracket/brace
  const lastBrace = text.lastIndexOf('}');
  const lastBracket = text.lastIndexOf(']');
  const sliceEnd = Math.max(lastBrace, lastBracket);
  if (sliceEnd !== -1) text = text.slice(0, sliceEnd + 1);

  // Heuristic fixes for common truncations (very conservative)
  if (expected === 'array') {
    if (!text.startsWith('[')) text = '[' + text;
    if (!text.endsWith(']')) text = text + ']';
  } else {
    // object expected
    if (text.startsWith('[') && expected === 'object') {
      // wrap array in object under data key
      return { data: safeParseJSON(text) || [] };
    }
    if (!text.startsWith('{')) text = '{' + text;
    if (!text.endsWith('}')) text = text + '}';
  }

  // Last attempt: remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');

  const parsed = safeParseJSON(text);
  if (parsed !== null) return parsed;
  // Fallback minimal structure
  return expected === 'array' ? [] : {};
}

class DataGenerator {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    });
    this.parser = new Parser();
    this.options = {
      database: 'PostgreSQL',
      multipleStatements: true,
      includeEnums: true,
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
    const { numRecords = 100 } = config;

    // Split the generation into multiple smaller requests
    const tables = Object.keys(schema.tables);
    const generatedData = {};

    for (const tableName of tables) {
      const prompt = `
        Generate synthetic data for the ${tableName} table.
        Generate ${numRecords} records while maintaining referential integrity.
        
        Table Schema:
        ${JSON.stringify(schema.tables[tableName], null, 2)}
        
        Full Schema Context (for relationships):
        ${JSON.stringify(schema, null, 2)}
        
        Additional Instructions:
        ${instructions || 'Generate realistic and consistent data'}
        
        Return ONLY a JSON array of records for the ${tableName} table.
        IMPORTANT: Return only the JSON array without any markdown formatting or code blocks.
      `;

      try {
        const result = await this.model.generateContent(prompt);
        const rawText = result.response.text();
        const cleanText = cleanGeminiJSON(rawText);

        // Parse the array response
        let tableData;
        try {
          // If it's a standalone array
          if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
            tableData = JSON.parse(cleanText);
          } else {
            // If it's wrapped in an object
            const parsed = JSON.parse(cleanText);
            tableData = parsed[tableName] || Object.values(parsed)[0];
          }
        } catch (innerError) {
          console.error(`Error parsing ${tableName} data:`, innerError);
          console.error('Clean text:', cleanText);
          throw new Error(`Failed to parse data for ${tableName}`);
        }

        if (!Array.isArray(tableData)) {
          throw new Error(`Generated data for ${tableName} is not an array`);
        }

        // Fallback: if model returns empty array, synthesize a placeholder row
        if (tableData.length === 0) {
          const placeholder = {};
          const cols = schema.tables[tableName]?.columns || {};
          Object.keys(cols).forEach((col) => {
            placeholder[col] = null;
          });
          tableData.push(placeholder);
        }

        generatedData[tableName] = tableData;
      } catch (error) {
        console.error(`Error generating data for ${tableName}:`, error);
        throw error;
      }
    }

    return generatedData;
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

export default DataGenerator;
